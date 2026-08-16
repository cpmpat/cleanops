import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { NoteTargetType, Prisma } from '@prisma/client';

/**
 * Manager messages — "Zpráva od manažera".
 *
 * Not to be confused with the two note fields that already exist:
 *   Turnover.managerNote  — a note about ONE cleaning, no confirmation
 *   Property.notes        — a standing fact about a unit, no confirmation
 * A Note is a broadcast to people and it has to be confirmed ("Rozumím").
 *
 * Targeting is exclusive — STAFF (named people) or PROPERTY (units) — and for
 * PROPERTY messages the recipient set is resolved on every read, never frozen
 * at send time. Whoever claims a turnover on that unit tomorrow sees the
 * message tomorrow, as long as it is still valid.
 */

/** Assignment states that mean "this person currently holds the cleaning". */
const HELD_ASSIGNMENT_STATUSES = ['ASSIGNED', 'STARTED'] as const;

/** Turnover states that are still open work. */
const OPEN_TURNOVER_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'FLAGGED',
] as const;

const LOCALES = ['cs', 'en', 'ru', 'uk'] as const;
type NoteLocale = (typeof LOCALES)[number];

interface Actor {
  userId: string;
  userRole: string;
}

export interface CreateNoteDto {
  targetType: NoteTargetType;
  title: string;
  bodyCs: string;
  bodyEn?: string | null;
  bodyRu?: string | null;
  bodyUk?: string | null;
  validFrom?: string | null;
  validUntil: string;
  userIds?: string[];
  propertyIds?: string[];
}

const AUTHOR_SELECT = {
  id: true,
  name: true,
  email: true,
  /** Powers the wa.me button on the cleaner's screen. */
  mobileNumber: true,
} as const;

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
  ) {}

  // ─── Cleaner side ──────────────────────────────────────────────────────────

  /**
   * Every valid message this user has not confirmed at its current version.
   *
   * Deliberately state-based, not event-based: the cleaner's tab stays open for
   * days and will miss websocket frames. This endpoint is the source of truth,
   * the socket only tells the client when to call it again.
   */
  async activeForUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, language: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const notes = await this.prisma.note.findMany({
      where: await this.recipientWhere(tenantId, userId),
      include: {
        author: { select: AUTHOR_SELECT },
        acks: { where: { userId } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return notes
      .filter((n) => !n.acks.some((a) => a.version === n.version))
      .map((n) => this.present(n, user.language as NoteLocale));
  }

  /** "Rozumím". Idempotent — a double tap is not an error. */
  async acknowledge(
    tenantId: string,
    userId: string,
    noteId: string,
    localeShown?: string,
  ) {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, tenantId },
      select: { id: true, version: true },
    });
    if (!note) throw new NotFoundException('Message not found');

    const isRecipient = await this.prisma.note.count({
      where: { AND: [{ id: noteId }, await this.recipientWhere(tenantId, userId)] },
    });
    if (!isRecipient) {
      throw new ForbiddenException('This message was not sent to you');
    }

    const ack = await this.prisma.noteAck.upsert({
      where: {
        noteId_userId_version: { noteId, userId, version: note.version },
      },
      create: { noteId, userId, version: note.version, localeShown },
      update: { localeShown },
    });

    this.gateway.emitToTenant(tenantId, 'note:changed', { id: noteId });
    return ack;
  }

  // ─── Manager side ──────────────────────────────────────────────────────────

  async create(tenantId: string, actor: Actor, dto: CreateNoteDto) {
    const { userIds, propertyIds } = await this.validateTargets(tenantId, dto);

    const validUntil = this.parseDate(dto.validUntil, 'validUntil');
    const validFrom = dto.validFrom
      ? this.parseDate(dto.validFrom, 'validFrom')
      : new Date();
    if (validUntil <= validFrom) {
      throw new BadRequestException('validUntil must be after validFrom');
    }
    if (!dto.title?.trim()) throw new BadRequestException('title is required');
    if (!dto.bodyCs?.trim()) {
      throw new BadRequestException('bodyCs is required — Czech is the source text');
    }

    const note = await this.prisma.note.create({
      data: {
        tenantId,
        authorId: actor.userId,
        targetType: dto.targetType,
        title: dto.title.trim(),
        bodyCs: dto.bodyCs.trim(),
        bodyEn: emptyToNull(dto.bodyEn),
        bodyRu: emptyToNull(dto.bodyRu),
        bodyUk: emptyToNull(dto.bodyUk),
        validFrom,
        validUntil,
        targets: {
          create:
            dto.targetType === 'STAFF'
              ? userIds.map((userId) => ({ userId }))
              : propertyIds.map((propertyId) => ({ propertyId })),
        },
      },
      include: { targets: true, author: { select: AUTHOR_SELECT } },
    });

    // One tenant-wide nudge. Clients re-read /notes/active, which is already
    // scoped per user — that keeps late joiners on PROPERTY messages correct
    // without the server having to guess who they are right now.
    this.gateway.emitToTenant(tenantId, 'note:changed', { id: note.id });
    this.logger.log(
      `Message "${note.title}" published by ${actor.userId} (${note.targetType})`,
    );

    return this.withRecipients(note);
  }

  async listForManager(tenantId: string, includeExpired = false) {
    const now = new Date();
    const notes = await this.prisma.note.findMany({
      where: {
        tenantId,
        isArchived: false,
        ...(includeExpired ? {} : { validUntil: { gte: now } }),
      },
      include: {
        author: { select: AUTHOR_SELECT },
        targets: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            property: { select: { id: true, name: true } },
          },
        },
        acks: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { ackedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(notes.map((n) => this.withRecipients(n)));
  }

  /**
   * Editing the text bumps the version, which invalidates every confirmation —
   * people must read and confirm the new wording. Changing only the validity
   * window does not.
   */
  async update(tenantId: string, noteId: string, dto: Partial<CreateNoteDto>) {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, tenantId },
    });
    if (!note) throw new NotFoundException('Message not found');

    const textChanged =
      (dto.title !== undefined && dto.title.trim() !== note.title) ||
      (dto.bodyCs !== undefined && dto.bodyCs.trim() !== note.bodyCs) ||
      (dto.bodyEn !== undefined && emptyToNull(dto.bodyEn) !== note.bodyEn) ||
      (dto.bodyRu !== undefined && emptyToNull(dto.bodyRu) !== note.bodyRu) ||
      (dto.bodyUk !== undefined && emptyToNull(dto.bodyUk) !== note.bodyUk);

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.bodyCs !== undefined && { bodyCs: dto.bodyCs.trim() }),
        ...(dto.bodyEn !== undefined && { bodyEn: emptyToNull(dto.bodyEn) }),
        ...(dto.bodyRu !== undefined && { bodyRu: emptyToNull(dto.bodyRu) }),
        ...(dto.bodyUk !== undefined && { bodyUk: emptyToNull(dto.bodyUk) }),
        ...(dto.validUntil && {
          validUntil: this.parseDate(dto.validUntil, 'validUntil'),
        }),
        ...(textChanged && { version: { increment: 1 } }),
      },
      include: { targets: true, author: { select: AUTHOR_SELECT } },
    });

    this.gateway.emitToTenant(tenantId, 'note:changed', { id: noteId });
    return this.withRecipients(updated);
  }

  async archive(tenantId: string, noteId: string) {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, tenantId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('Message not found');

    const updated = await this.prisma.note.update({
      where: { id: noteId },
      data: { isArchived: true },
    });
    this.gateway.emitToTenant(tenantId, 'note:changed', { id: noteId });
    return updated;
  }

  // ─── Recipient resolution ──────────────────────────────────────────────────

  /**
   * Properties this user is currently responsible for: anything they hold an
   * open turnover on, plus anything they are the default cleaner for.
   */
  private async propertyIdsForUser(
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const [held, defaults] = await Promise.all([
      this.prisma.turnoverAssignment.findMany({
        where: {
          userId,
          status: { in: HELD_ASSIGNMENT_STATUSES as any },
          turnover: { tenantId, status: { in: OPEN_TURNOVER_STATUSES as any } },
        },
        select: { turnover: { select: { propertyId: true } } },
      }),
      this.prisma.property.findMany({
        where: { tenantId, defaultCleanerId: userId, isActive: true },
        select: { id: true },
      }),
    ]);

    return Array.from(
      new Set([
        ...held.map((a) => a.turnover.propertyId),
        ...defaults.map((p) => p.id),
      ]),
    );
  }

  /** Prisma `where` matching every valid message addressed to this user. */
  private async recipientWhere(tenantId: string, userId: string) {
    const propertyIds = await this.propertyIdsForUser(tenantId, userId);
    const now = new Date();

    return {
      tenantId,
      isArchived: false,
      validFrom: { lte: now },
      validUntil: { gte: now },
      targets: {
        some: {
          OR: [
            { userId },
            ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : []),
          ],
        },
      },
    } satisfies Prisma.NoteWhereInput;
  }

  /** Who this message reaches right now — used by the manager view. */
  private async resolveRecipients(note: {
    id: string;
    tenantId: string;
    targetType: NoteTargetType;
    targets?: { userId: string | null; propertyId: string | null }[];
  }) {
    const targets =
      note.targets ??
      (await this.prisma.noteTarget.findMany({ where: { noteId: note.id } }));

    if (note.targetType === 'STAFF') {
      const userIds = targets.map((t) => t.userId).filter(Boolean) as string[];
      return this.prisma.user.findMany({
        where: { id: { in: userIds }, tenantId: note.tenantId, isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      });
    }

    const propertyIds = targets
      .map((t) => t.propertyId)
      .filter(Boolean) as string[];
    if (!propertyIds.length) return [];

    const [held, defaults] = await Promise.all([
      this.prisma.turnoverAssignment.findMany({
        where: {
          status: { in: HELD_ASSIGNMENT_STATUSES as any },
          turnover: {
            tenantId: note.tenantId,
            propertyId: { in: propertyIds },
            status: { in: OPEN_TURNOVER_STATUSES as any },
          },
        },
        select: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.property.findMany({
        where: { id: { in: propertyIds }, defaultCleanerId: { not: null } },
        select: {
          defaultCleaner: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const byId = new Map<string, { id: string; name: string; email: string }>();
    held.forEach((a) => a.user && byId.set(a.user.id, a.user));
    defaults.forEach(
      (p) => p.defaultCleaner && byId.set(p.defaultCleaner.id, p.defaultCleaner),
    );
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async withRecipients(note: any) {
    const recipients = await this.resolveRecipients(note);
    const acks = note.acks ?? [];
    const ackedUserIds = new Set(
      acks.filter((a: any) => a.version === note.version).map((a: any) => a.userId),
    );

    return {
      ...note,
      recipients,
      ackedCount: recipients.filter((r) => ackedUserIds.has(r.id)).length,
      recipientCount: recipients.length,
      pending: recipients.filter((r) => !ackedUserIds.has(r.id)),
      /**
       * A property message with nobody on it yet is NOT delivered. Say so,
       * instead of letting the manager assume the team has been told.
       */
      awaitingRecipients: note.targetType === 'PROPERTY' && recipients.length === 0,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve the body for a reader: their language, Czech as the fallback. */
  private present(note: any, language: NoteLocale) {
    const bodies: Record<NoteLocale, string | null> = {
      cs: note.bodyCs,
      en: note.bodyEn,
      ru: note.bodyRu,
      uk: note.bodyUk,
    };

    const localeShown: NoteLocale = bodies[language] ? language : 'cs';

    return {
      id: note.id,
      title: note.title,
      body: bodies[localeShown],
      localeShown,
      /** Other languages this message exists in — powers "show in Ukrainian". */
      availableLocales: LOCALES.filter((l) => !!bodies[l]),
      bodies,
      version: note.version,
      targetType: note.targetType,
      validUntil: note.validUntil,
      createdAt: note.createdAt,
      author: note.author,
    };
  }

  private async validateTargets(tenantId: string, dto: CreateNoteDto) {
    const userIds = dedupe(dto.userIds);
    const propertyIds = dedupe(dto.propertyIds);

    if (dto.targetType === 'STAFF') {
      if (!userIds.length) {
        throw new BadRequestException('Pick at least one person');
      }
      if (propertyIds.length) {
        throw new BadRequestException(
          'A message goes either to people or to properties, never both',
        );
      }
      const found = await this.prisma.user.count({
        where: { id: { in: userIds }, tenantId, isActive: true },
      });
      if (found !== userIds.length) {
        throw new BadRequestException('Some recipients do not exist in this tenant');
      }
    } else if (dto.targetType === 'PROPERTY') {
      if (!propertyIds.length) {
        throw new BadRequestException('Pick at least one property');
      }
      if (userIds.length) {
        throw new BadRequestException(
          'A message goes either to people or to properties, never both',
        );
      }
      const found = await this.prisma.property.count({
        where: { id: { in: propertyIds }, tenantId },
      });
      if (found !== propertyIds.length) {
        throw new BadRequestException('Some properties do not exist in this tenant');
      }
    } else {
      throw new BadRequestException('targetType must be STAFF or PROPERTY');
    }

    return { userIds, propertyIds };
  }

  private parseDate(value: string, field: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    return d;
  }
}

function dedupe(ids?: string[]): string[] {
  return Array.from(new Set(ids ?? [])).filter(Boolean);
}

function emptyToNull(v?: string | null): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}
