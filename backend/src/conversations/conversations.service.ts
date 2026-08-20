import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { CleanOpsGateway } from '../websocket/websocket.module';

/**
 * Conversations — the open channel on a turnover.
 *
 * Rules that are not obvious from the schema:
 *
 *  · Two kinds. A TURNOVER chat is opened by whoever is doing the work and is
 *    part of that cleaning's record. A DIRECT chat is opened by the office
 *    towards people and belongs to nothing else — only a manager can start one.
 *  · A cleaner may open a turnover channel only on work they hold and have
 *    STARTED. Before that there is nothing concrete to discuss and the pool
 *    would fill with speculative threads.
 *  · Every manager is a member from the start. A cleaner opens a channel
 *    towards the office, not a private chat, so she never picks who to send to.
 *  · A cleaner may invite other cleaners. A manager may invite anyone. The UI
 *    shows the forbidden rows greyed out rather than hiding them — hidden
 *    people read as a broken list.
 *  · SYSTEM messages carry JSON in `body`, not a sentence. The team reads four
 *    languages; a Czech string baked in by the server would be wrong for most
 *    of them.
 */

/**
 * The office.
 *
 * These roles are members of every turnover chat from the moment it opens, may
 * invite anybody, may read any thread, and may start a direct chat. A cleaner
 * writing "to the front desk" should not have to guess who is on shift, so the
 * whole desk is in the room and whoever is free answers.
 */
const OFFICE_ROLES = [
  'MANAGER',
  'ADMIN',
  'OPERATION_MANAGER',
  'FRONT_DESK_MANAGER',
  'FRONT_DESK',
  'ASSIST',
] as const;
/** Roles a cleaner is allowed to pull in. */
const CLEANER_INVITABLE_ROLES = ['CLEANER'] as const;

const HELD_ASSIGNMENT_STATUSES = ['ASSIGNED', 'STARTED'] as const;

/**
 * How long a finished turnover's chat stays in the inbox.
 *
 * Without this the list only ever grows, and an inbox nobody can face is an
 * inbox nobody reads. A star exempts a thread from the sweep; remove the star
 * and the next sweep takes it like any other.
 */
const ARCHIVE_AFTER_DAYS = 30;

interface Actor {
  userId: string;
  userRole: string;
}

const MEMBER_SELECT = {
  id: true,
  userId: true,
  addedAt: true,
  lastReadAt: true,
  starred: true,
  user: { select: { id: true, name: true, email: true, role: true } },
} as const;

const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true, email: true, role: true } },
  attachments: true,
} as const;

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
  ) {}

  // ─── Opening ───────────────────────────────────────────────────────────────

  /**
   * Open the channel for a turnover, or hand back the one that already exists.
   * Idempotent on purpose: the button on the card is "message the office", not
   * "create a thread", and tapping it twice must not produce two rooms.
   */
  async openForTurnover(tenantId: string, actor: Actor, turnoverId: string) {
    const turnover = await this.prisma.turnover.findFirst({
      where: { id: turnoverId, tenantId },
      include: {
        property: { select: { id: true, name: true } },
        assignments: { where: { status: { in: HELD_ASSIGNMENT_STATUSES as any } } },
      },
    });
    if (!turnover) throw new NotFoundException('Turnover not found');

    const existing = await this.prisma.conversation.findFirst({
      where: { turnoverId, tenantId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) {
      await this.ensureMember(existing.id, actor);
      return this.get(tenantId, actor, existing.id);
    }

    this.assertMayOpen(actor, turnover);

    const office = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: OFFICE_ROLES as any } },
      select: { id: true },
    });

    const memberIds = Array.from(new Set([actor.userId, ...office.map((u) => u.id)]));

    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId,
        turnoverId,
        createdById: actor.userId,
        lastMessageAt: new Date(),
        members: { create: memberIds.map((userId) => ({ userId })) },
        messages: {
          create: {
            kind: 'SYSTEM',
            body: JSON.stringify({
              event: 'opened',
              property: turnover.property?.name ?? null,
            }),
          },
        },
      },
      select: { id: true },
    });

    this.logger.log(
      `Conversation opened on turnover ${turnoverId} by ${actor.userId}`,
    );
    this.notifyMembers(conversation.id);
    return this.get(tenantId, actor, conversation.id);
  }

  /**
   * The gate. Managers always; a cleaner only on work she holds and has
   * started — `startedAt` is the difference between "I am standing in the flat"
   * and "I might take this later".
   */
  private assertMayOpen(actor: Actor, turnover: any) {
    if ((OFFICE_ROLES as readonly string[]).includes(actor.userRole)) return;

    const mine = turnover.assignments?.some((a: any) => a.userId === actor.userId);
    if (!mine) {
      throw new ForbiddenException(
        'You can only open a channel on a cleaning you have taken',
      );
    }
    if (!turnover.startedAt) {
      throw new ForbiddenException(
        'Start the cleaning first — then you can message the office about it',
      );
    }
  }

  /**
   * A direct chat: the office writing to people, about nothing in particular.
   *
   * Only the office may start one. A cleaner who wants something has a specific
   * cleaning in front of her, and that conversation belongs on the turnover
   * where anyone looking at that flat later will find it.
   */
  async openDirect(
    tenantId: string,
    actor: Actor,
    dto: { userIds: string[]; title?: string; body?: string },
  ) {
    if (!(OFFICE_ROLES as readonly string[]).includes(actor.userRole)) {
      throw new ForbiddenException(
        'Only a manager can start a direct chat. From a cleaning, open its own channel instead.',
      );
    }

    const userIds = Array.from(new Set(dto.userIds ?? [])).filter(Boolean);
    if (!userIds.length) throw new BadRequestException('Pick at least one person');

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, tenantId, isActive: true },
      select: { id: true },
    });
    if (users.length !== userIds.length) {
      throw new BadRequestException('Some people no longer exist');
    }

    const memberIds = Array.from(new Set([actor.userId, ...userIds]));

    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId,
        kind: 'DIRECT',
        title: dto.title?.trim() || null,
        createdById: actor.userId,
        lastMessageAt: new Date(),
        members: { create: memberIds.map((userId) => ({ userId })) },
        messages: {
          create: {
            kind: 'SYSTEM',
            body: JSON.stringify({ event: 'opened_direct', title: dto.title ?? null }),
          },
        },
      },
      select: { id: true },
    });

    if (dto.body?.trim()) {
      await this.postMessage(tenantId, actor, conversation.id, { body: dto.body });
    }

    this.notifyMembers(conversation.id);
    return this.get(tenantId, actor, conversation.id);
  }

  // ─── Reading ───────────────────────────────────────────────────────────────

  async listForUser(tenantId: string, userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        archivedAt: null,
        members: { some: { userId, leftAt: null } },
      },
      include: {
        turnover: {
          select: {
            id: true,
            startedAt: true,
            completedAt: true,
            property: { select: { id: true, name: true } },
            fromBooking: { select: { checkOutTime: true } },
            toBooking: { select: { checkInTime: true } },
          },
        },
        members: { select: MEMBER_SELECT },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: MESSAGE_INCLUDE,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    return Promise.all(
      conversations.map(async (c) => ({
        ...c,
        lastMessage: c.messages[0] ?? null,
        messages: undefined,
        unreadCount: await this.unreadFor(c.id, userId),
      })),
    );
  }

  async get(tenantId: string, actor: Actor, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        turnover: {
          select: {
            id: true,
            startedAt: true,
            completedAt: true,
            property: { select: { id: true, name: true, pmsPropertyId: true } },
            fromBooking: { select: { checkOutTime: true } },
            toBooking: { select: { checkInTime: true, numAdults: true, numChildren: true } },
          },
        },
        members: { select: MEMBER_SELECT, orderBy: { addedAt: 'asc' } },
        messages: { include: MESSAGE_INCLUDE, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.assertMember(conversation, actor);
    return conversation;
  }

  /** Unread across every channel — the tab badge. */
  async unreadCount(tenantId: string, userId: string) {
    const members = await this.prisma.conversationMember.findMany({
      where: { userId, leftAt: null, conversation: { tenantId } },
      select: { conversationId: true, lastReadAt: true },
    });

    let count = 0;
    for (const m of members) {
      count += await this.prisma.conversationMessage.count({
        where: {
          conversationId: m.conversationId,
          authorId: { not: userId },
          kind: 'TEXT',
          ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
        },
      });
    }
    return { count };
  }

  async markRead(tenantId: string, userId: string, id: string) {
    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId: id, userId, conversation: { tenantId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException('You are not in this conversation');

    await this.prisma.conversationMember.update({
      where: { id: member.id },
      data: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Keep this thread. Starring is per person: what one cleaner needs to hold on
   * to is not what another does, and the office keeping a thread should not
   * pin it into everybody's inbox.
   */
  async setStarred(tenantId: string, userId: string, id: string, starred: boolean) {
    const member = await this.prisma.conversationMember.findFirst({
      where: { conversationId: id, userId, conversation: { tenantId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException('You are not in this conversation');

    await this.prisma.conversationMember.update({
      where: { id: member.id },
      data: { starred },
    });
    return { starred };
  }

  /**
   * Nightly sweep: archive chats whose cleaning finished more than 30 days ago
   * and which nobody kept.
   *
   * Archived means gone from the inbox and closed to new messages — not
   * deleted. The history stays queryable, which is the entire reason this
   * lives in our database instead of somebody's phone.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async archiveFinishedChats() {
    const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const stale = await this.prisma.conversation.findMany({
      where: {
        archivedAt: null,
        // Only turnover chats age out: a direct chat has no piece of work whose
        // completion could start the clock.
        kind: 'TURNOVER',
        turnover: { completedAt: { lt: cutoff } },
        // One star from anyone keeps the thread alive for everyone in it —
        // splitting a thread per person would be worse than keeping it.
        members: { none: { starred: true } },
      },
      select: { id: true },
    });
    if (!stale.length) return { archived: 0 };

    await this.prisma.conversation.updateMany({
      where: { id: { in: stale.map((c) => c.id) } },
      data: { archivedAt: new Date(), status: 'CLOSED' },
    });

    this.logger.log(`Archived ${stale.length} finished turnover chats`);
    return { archived: stale.length };
  }

  // ─── Writing ───────────────────────────────────────────────────────────────

  async postMessage(
    tenantId: string,
    actor: Actor,
    id: string,
    dto: {
      body?: string;
      attachments?: {
        url: string;
        mimeType?: string;
        bytes?: number;
        width?: number;
        height?: number;
      }[];
    },
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { members: { select: { userId: true, leftAt: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.assertMember(conversation, actor);
    if (conversation.status === 'CLOSED') {
      throw new BadRequestException('This conversation is closed');
    }

    const body = dto.body?.trim();
    const attachments = dto.attachments ?? [];
    if (!body && !attachments.length) {
      throw new BadRequestException('Write something or attach a picture');
    }
    // Images only for now. The enum has VIDEO so that adding it later is a
    // value change, not a migration.
    for (const a of attachments) {
      if (a.mimeType && !a.mimeType.startsWith('image/')) {
        throw new BadRequestException('Only pictures can be attached for now');
      }
    }

    const message = await this.prisma.conversationMessage.create({
      data: {
        conversationId: id,
        authorId: actor.userId,
        kind: 'TEXT',
        body: body || null,
        attachments: {
          create: attachments.map((a) => ({
            kind: 'IMAGE' as const,
            url: a.url,
            mimeType: a.mimeType,
            bytes: a.bytes,
            width: a.width,
            height: a.height,
          })),
        },
      },
      include: MESSAGE_INCLUDE,
    });

    await this.prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: message.createdAt },
    });
    await this.markRead(tenantId, actor.userId, id);

    this.notifyMembers(id);
    return message;
  }

  // ─── Members ───────────────────────────────────────────────────────────────

  /**
   * Who this person may still add. Everyone is returned; the ones they are not
   * allowed to invite come back with `canInvite: false` so the sheet can show
   * them greyed out with a reason instead of pretending they do not exist.
   */
  async candidates(tenantId: string, actor: Actor, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { members: { select: { userId: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.assertMember(conversation, actor);

    const memberIds = new Set(conversation.members.map((m) => m.userId));
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, id: { notIn: Array.from(memberIds) } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    return users.map((u) => ({
      ...u,
      canInvite: this.mayInvite(actor.userRole, u.role),
    }));
  }

  async addMembers(tenantId: string, actor: Actor, id: string, userIds: string[]) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: { members: { select: { userId: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.assertMember(conversation, actor);

    const ids = Array.from(new Set(userIds ?? [])).filter(Boolean);
    if (!ids.length) throw new BadRequestException('Nobody selected');

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, tenantId, isActive: true },
      select: { id: true, name: true, role: true },
    });
    if (users.length !== ids.length) {
      throw new BadRequestException('Some people no longer exist');
    }

    const actorName = await this.prisma.user
      .findUnique({ where: { id: actor.userId }, select: { name: true } })
      .then((u) => u?.name ?? '');

    for (const user of users) {
      if (!this.mayInvite(actor.userRole, user.role)) {
        throw new ForbiddenException(
          `You cannot add ${user.name} to this conversation`,
        );
      }
    }

    const already = new Set(conversation.members.map((m) => m.userId));
    const fresh = users.filter((u) => !already.has(u.id));
    if (!fresh.length) return this.get(tenantId, actor, id);

    await this.prisma.$transaction([
      this.prisma.conversationMember.createMany({
        data: fresh.map((u) => ({
          conversationId: id,
          userId: u.id,
          addedById: actor.userId,
        })),
        skipDuplicates: true,
      }),
      ...fresh.map((u) =>
        this.prisma.conversationMessage.create({
          data: {
            conversationId: id,
            kind: 'SYSTEM' as const,
            body: JSON.stringify({
              event: 'member_added',
              actor: actorName,
              target: u.name,
            }),
          },
        }),
      ),
    ]);

    this.notifyMembers(id);
    return this.get(tenantId, actor, id);
  }

  /** Cleaners may bring in cleaners. The office may bring in anyone. */
  private mayInvite(actorRole: string, targetRole: string): boolean {
    if ((OFFICE_ROLES as readonly string[]).includes(actorRole)) return true;
    if (actorRole === 'CLEANER') {
      return (CLEANER_INVITABLE_ROLES as readonly string[]).includes(targetRole);
    }
    return false;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private assertMember(conversation: { members: { userId: string }[] }, actor: Actor) {
    if ((OFFICE_ROLES as readonly string[]).includes(actor.userRole)) return;
    if (!conversation.members.some((m) => m.userId === actor.userId)) {
      throw new ForbiddenException('You are not in this conversation');
    }
  }

  /** A manager reading a channel they were not in yet joins by reading it. */
  private async ensureMember(conversationId: string, actor: Actor) {
    await this.prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      create: { conversationId, userId: actor.userId },
      update: {},
    });
  }

  private async unreadFor(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadAt: true },
    });
    return this.prisma.conversationMessage.count({
      where: {
        conversationId,
        authorId: { not: userId },
        kind: 'TEXT',
        ...(member?.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}),
      },
    });
  }

  /**
   * Tell every member to re-read. Same shape as notes: the socket says "look
   * again", the endpoint is the truth — these tabs stay open for days and drop
   * frames.
   */
  private async notifyMembers(conversationId: string) {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true },
    });
    for (const m of members) {
      this.gateway.emitToUser(m.userId, 'conversation:changed', { conversationId });
    }
  }
}
