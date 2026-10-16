import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskPriority, TaskResolution, TaskStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { TASK_ROLES, isTaskManager } from '../common/roles';
import { DatasetsService, DB_MODELS, RecordRef, ResolvedRecord, TABS } from '../datasets/datasets.service';

/**
 * Tasks — a Jira-like board for the office (16 Oct 2026).
 *
 * Stages NEW → TODO → IN_PROGRESS → ON_HOLD → REVIEW → DONE.
 *   - Task managers (MANAGER, FRONT_DESK_MANAGER, DIRECTOR, REVENUE_MANAGER;
 *     ADMIN) create, edit and assign.
 *   - Only the task's creator closes it (Done / Won't do) and reopens it
 *     (Patrik, 16 Oct 2026). If the creator's account is deactivated, any
 *     task manager may, so no task is left unclosable.
 *   - Assignees move their task between the open stages; moving it to REVIEW
 *     is how they suggest closing it — the creator then decides.
 *   - Everyone with the board may comment, tag (@) and watch.
 *
 * Who the task hangs on ("on whom"): whoever it is waiting on (open waits);
 * otherwise the creator while it is NEW or in REVIEW; otherwise the assignees.
 * A tag (@) only notifies: the writer decides whether to also put the task
 * on that person (Patrik, 16 Oct 2026). Their reply in the thread closes it.
 *
 * Waiting never touches the assignees. They are who is responsible; a wait
 * only says whose turn it is right now, and when it ends the turn goes back
 * to them. An active task (To do → Review) always has at least one assignee:
 * it cannot enter those stages without one and the last one cannot be
 * removed while it is there (Patrik, 16 Oct 2026).
 */

export type Actor = { userId: string; role: string };

const STATUSES: TaskStatus[] = ['NEW', 'TODO', 'IN_PROGRESS', 'ON_HOLD', 'REVIEW', 'DONE'];
/** Stages in which somebody must be responsible: at least one assignee. */
const ACTIVE: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'ON_HOLD', 'REVIEW'];
const NEEDS_ASSIGNEE = 'An active task needs at least one assignee. Assign someone first.';
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
/** Done tasks stay on the board this long, then only "show older" lists them. */
const DONE_DAYS = 14;

const PERSON = { select: { id: true, name: true, email: true, role: true, isActive: true } } as const;

const CARD_INCLUDE = {
  assignees: { include: { user: PERSON }, orderBy: { addedAt: 'asc' as const } },
  waits: { where: { resolvedAt: null }, include: { user: PERSON }, orderBy: { createdAt: 'asc' as const } },
  watchers: { select: { userId: true } },
  createdBy: PERSON,
  links: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { comments: true } },
};

type CardRow = Prisma.TaskGetPayload<{ include: typeof CARD_INCLUDE }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: CleanOpsGateway,
    private readonly datasets: DatasetsService,
  ) {}

  /** The creator closes and reopens; a task manager only stands in for a deactivated creator. */
  private canClose(t: CardRow, actor: Actor): boolean {
    if (t.createdById === actor.userId) return true;
    return !t.createdBy.isActive && isTaskManager(actor.role);
  }

  private canMove(t: CardRow, actor: Actor): boolean {
    return isTaskManager(actor.role) || t.assignees.some((a) => a.userId === actor.userId);
  }

  /** Name every linked record for this viewer, in one pass per list. */
  private async resolveLinks(tenantId: string, actor: Actor, rows: CardRow[]): Promise<Map<string, ResolvedRecord & { id: string }>> {
    const links = rows.flatMap((t) => t.links);
    const resolved = await this.datasets.resolveRecords(tenantId, actor.role as any, links.map((l) => ({ dataset: l.dataset, rowId: l.rowId, field: l.field })));
    return new Map(links.map((l, i) => [l.id, { ...resolved[i], id: l.id }]));
  }

  // ─── Visibility ────────────────────────────────────────────────────────────

  /**
   * Which tasks a role sees. Every office role sees the whole board today.
   * When cleaners, agents or repairmen get access, they get the second
   * branch: only tasks they created, are assigned to, watch or are tagged in.
   */
  private visibleWhere(role: string, userId: string): Prisma.TaskWhereInput {
    if ((TASK_ROLES as readonly string[]).includes(role)) return {};
    return {
      OR: [
        { createdById: userId },
        { assignees: { some: { userId } } },
        { watchers: { some: { userId } } },
        { waits: { some: { userId } } },
      ],
    };
  }

  private async load(tenantId: string, id: string, actor: Actor) {
    const task = await this.prisma.task.findFirst({
      where: { id, tenantId, ...this.visibleWhere(actor.role, actor.userId) },
      include: CARD_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /** On whom the task hangs right now, and why. */
  private onWhom(t: CardRow): { ids: string[]; reason: 'waiting' | 'review' | 'triage' | 'assigned' | 'none' } {
    if (t.status === 'DONE') return { ids: [], reason: 'none' };
    const waiting = [...new Set(t.waits.map((w) => w.userId))];
    if (waiting.length) return { ids: waiting, reason: 'waiting' };
    if (t.status === 'REVIEW') return { ids: [t.createdById], reason: 'review' };
    if (t.status === 'NEW') return { ids: [t.createdById], reason: 'triage' };
    // A deactivated assignee is responsible for nothing; with nobody active
    // left the task falls back to its creator, who has to reassign it.
    const assigned = t.assignees.filter((a) => a.user.isActive).map((a) => a.userId);
    return assigned.length ? { ids: assigned, reason: 'assigned' } : { ids: [t.createdById], reason: 'triage' };
  }

  private card(t: CardRow, actor: Actor, links: Map<string, ResolvedRecord & { id: string }>) {
    const me = actor.userId;
    const on = this.onWhom(t);
    return {
      id: t.id,
      number: t.number,
      key: `T-${t.number}`,
      title: t.title,
      status: t.status,
      resolution: t.resolution,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      holdReason: t.holdReason,
      rank: t.rank,
      createdBy: t.createdBy,
      assignees: t.assignees.map((a) => a.user),
      waitingOn: t.waits.map((w) => ({ waitId: w.id, since: w.createdAt, user: w.user })),
      onWhom: on.ids,
      onWhomReason: on.reason,
      onMe: on.ids.includes(me),
      watching: t.watchers.some((w) => w.userId === me),
      commentCount: t._count.comments,
      links: t.links.map((l) => links.get(l.id)).filter(Boolean),
      canClose: this.canClose(t, actor),
      canMove: this.canMove(t, actor),
      closedAt: t.closedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  // ─── People ────────────────────────────────────────────────────────────────

  /** Who can be assigned or tagged: active users of the office app. */
  async people(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: [...TASK_ROLES] as any } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  private async assertPeople(tenantId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await this.prisma.user.count({
      where: { tenantId, isActive: true, id: { in: ids }, role: { in: [...TASK_ROLES] as any } },
    });
    if (found !== ids.length) throw new BadRequestException('Only office-app users can be assigned or tagged');
  }

  // ─── Board ─────────────────────────────────────────────────────────────────

  async board(tenantId: string, actor: Actor, opts: { allDone?: boolean } = {}) {
    const since = new Date(Date.now() - DONE_DAYS * 86_400_000);
    const rows = await this.prisma.task.findMany({
      where: {
        tenantId,
        // AND, not spread: both pieces may carry an OR of their own.
        AND: [
          this.visibleWhere(actor.role, actor.userId),
          opts.allDone ? {} : { OR: [{ status: { not: 'DONE' } }, { closedAt: { gte: since } }] },
        ],
      },
      include: CARD_INCLUDE,
      orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
    });
    const links = await this.resolveLinks(tenantId, actor, rows);
    return {
      statuses: STATUSES,
      canCreate: isTaskManager(actor.role),
      doneDays: DONE_DAYS,
      tasks: rows.map((r) => this.card(r, actor, links)),
    };
  }

  /** The sidebar badge: tasks hanging on me, and unread Tasks notifications. */
  async badge(tenantId: string, actor: Actor) {
    const open = await this.prisma.task.findMany({
      where: {
        tenantId,
        status: { not: 'DONE' },
        AND: [
          this.visibleWhere(actor.role, actor.userId),
          {
            OR: [
              { createdById: actor.userId },
              { assignees: { some: { userId: actor.userId } } },
              { waits: { some: { userId: actor.userId, resolvedAt: null } } },
            ],
          },
        ],
      },
      include: CARD_INCLUDE,
    });
    const onMe = open.filter((t) => this.onWhom(t).ids.includes(actor.userId)).length;
    const unread = await this.prisma.taskNotification.count({ where: { tenantId, userId: actor.userId, readAt: null } });
    return { onMe, unread };
  }

  // ─── Detail ────────────────────────────────────────────────────────────────

  async detail(tenantId: string, id: string, actor: Actor) {
    const t = await this.load(tenantId, id, actor);
    const [comments, events, waits, watchers, closedBy] = await Promise.all([
      this.prisma.taskComment.findMany({
        where: { taskId: id },
        include: { author: PERSON },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.taskEvent.findMany({
        where: { taskId: id },
        include: { actor: PERSON },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.taskWait.findMany({
        where: { taskId: id },
        include: { user: PERSON, requestedBy: PERSON },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.taskWatcher.findMany({ where: { taskId: id }, include: { user: PERSON }, orderBy: { addedAt: 'asc' } }),
      t.closedById ? this.prisma.user.findUnique({ where: { id: t.closedById }, ...PERSON }) : null,
    ]);
    const manager = isTaskManager(actor.role);
    const links = await this.resolveLinks(tenantId, actor, [t]);
    return {
      ...this.card(t, actor, links),
      description: t.description,
      closedBy,
      watchers: watchers.map((w) => w.user),
      comments: comments.map((c) => ({ id: c.id, body: c.body, mentionIds: c.mentionIds, createdAt: c.createdAt, editedAt: c.editedAt, author: c.author })),
      events: events.map((e) => ({ id: e.id, kind: e.kind, data: e.data, createdAt: e.createdAt, actor: e.actor })),
      waits: waits.map((w) => ({
        id: w.id, user: w.user, requestedBy: w.requestedBy, createdAt: w.createdAt,
        resolvedAt: w.resolvedAt, resolvedReason: w.resolvedReason,
      })),
      linkAuthors: Object.fromEntries(t.links.map((l) => [l.id, l.addedById])),
      can: {
        edit: manager,
        assign: manager,
        close: this.canClose(t, actor),
        move: this.canMove(t, actor),
        link: this.canMove(t, actor),
      },
    };
  }

  // ─── Create / edit ─────────────────────────────────────────────────────────

  async create(tenantId: string, actor: Actor, dto: {
    title?: string; description?: string; priority?: string; dueDate?: string | null;
    assigneeIds?: string[]; status?: string; links?: RecordRef[];
  }) {
    if (!isTaskManager(actor.role)) throw new ForbiddenException('Only managers create tasks');
    const linkRefs = this.cleanLinks(dto.links);
    for (const ref of linkRefs) await this.datasets.assertLinkable(tenantId, actor.role as any, ref);
    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('A task needs a title');
    if (title.length > 200) throw new BadRequestException('Title is too long (max 200)');
    const description = (dto.description ?? '').trim().slice(0, 10_000) || null;
    const priority = this.priority(dto.priority);
    const dueDate = this.date(dto.dueDate);
    const assigneeIds = [...new Set(dto.assigneeIds ?? [])].filter(Boolean);
    await this.assertPeople(tenantId, assigneeIds);
    const status: TaskStatus = dto.status === 'TODO' || dto.status === 'NEW'
      ? dto.status
      : assigneeIds.length ? 'TODO' : 'NEW';
    if (ACTIVE.includes(status) && !assigneeIds.length) throw new BadRequestException(NEEDS_ASSIGNEE);

    let created: { id: string; number: number } | null = null;
    for (let attempt = 0; attempt < 4 && !created; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const last = await tx.task.aggregate({ where: { tenantId }, _max: { number: true } });
          const top = await tx.task.aggregate({ where: { tenantId, status }, _min: { rank: true } });
          const task = await tx.task.create({
            data: {
              tenantId, title, description, priority, dueDate, status,
              number: (last._max.number ?? 0) + 1,
              rank: (top._min.rank ?? 1) - 1,
              createdById: actor.userId,
              assignees: { create: assigneeIds.map((userId) => ({ userId, addedById: actor.userId })) },
              watchers: { create: [...new Set([actor.userId, ...assigneeIds])].map((userId) => ({ userId })) },
              links: { create: linkRefs.map((l) => ({ dataset: l.dataset, rowId: l.rowId, field: l.field ?? null, addedById: actor.userId })) },
            },
            select: { id: true, number: true },
          });
          await tx.taskEvent.create({ data: { taskId: task.id, actorId: actor.userId, kind: 'created', data: { status } } });
          return task;
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // a colleague took the same number; try the next
      }
    }
    if (!created) throw new BadRequestException('Could not number the task, try again');

    await this.notify(tenantId, created.id, actor.userId, assigneeIds, 'assigned', title);
    this.changed(tenantId, created.id);
    return this.detail(tenantId, created.id, actor);
  }

  async update(tenantId: string, id: string, actor: Actor, dto: {
    title?: string; description?: string | null; priority?: string; dueDate?: string | null; holdReason?: string | null;
  }) {
    if (!isTaskManager(actor.role)) throw new ForbiddenException('Only managers edit tasks');
    const t = await this.load(tenantId, id, actor);
    const data: Prisma.TaskUpdateInput = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    if (dto.title !== undefined) {
      const title = String(dto.title).trim();
      if (!title) throw new BadRequestException('A task needs a title');
      if (title !== t.title) { data.title = title.slice(0, 200); changed.title = { from: t.title, to: data.title }; }
    }
    if (dto.description !== undefined) {
      const d = (dto.description ?? '').trim().slice(0, 10_000) || null;
      if (d !== (t.description ?? null)) { data.description = d; changed.description = { from: null, to: null }; }
    }
    if (dto.priority !== undefined) {
      const p = this.priority(dto.priority);
      if (p !== t.priority) { data.priority = p; changed.priority = { from: t.priority, to: p }; }
    }
    if (dto.dueDate !== undefined) {
      const d = this.date(dto.dueDate);
      const before = t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null;
      const after = d ? d.toISOString().slice(0, 10) : null;
      if (before !== after) { data.dueDate = d; changed.dueDate = { from: before, to: after }; }
    }
    if (dto.holdReason !== undefined) {
      const h = (dto.holdReason ?? '').trim().slice(0, 300) || null;
      if (h !== (t.holdReason ?? null)) { data.holdReason = h; changed.holdReason = { from: t.holdReason, to: h }; }
    }
    if (!Object.keys(changed).length) return this.detail(tenantId, id, actor);
    await this.prisma.task.update({ where: { id }, data });
    await this.event(id, actor.userId, 'edited', { fields: Object.keys(changed), changed });
    if (changed.priority || changed.dueDate) {
      await this.notify(tenantId, id, actor.userId, await this.audience(id), 'edited',
        Object.keys(changed).filter((k) => k === 'priority' || k === 'dueDate').join(','));
    }
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  async setAssignees(tenantId: string, id: string, actor: Actor, userIds: string[]) {
    if (!isTaskManager(actor.role)) throw new ForbiddenException('Only managers assign tasks');
    const t = await this.load(tenantId, id, actor);
    const want = [...new Set(userIds ?? [])].filter(Boolean);
    await this.assertPeople(tenantId, want);
    if (ACTIVE.includes(t.status) && !want.length) {
      throw new BadRequestException('Someone must stay responsible while the task is active. Add the new assignee before removing the last one, or move the task back to New.');
    }
    const had = t.assignees.map((a) => a.userId);
    const added = want.filter((u) => !had.includes(u));
    const removed = had.filter((u) => !want.includes(u));
    if (!added.length && !removed.length) return this.detail(tenantId, id, actor);
    await this.prisma.$transaction([
      this.prisma.taskAssignee.deleteMany({ where: { taskId: id, userId: { in: removed } } }),
      this.prisma.taskAssignee.createMany({ data: added.map((userId) => ({ taskId: id, userId, addedById: actor.userId })) }),
      this.prisma.taskWatcher.createMany({ data: added.map((userId) => ({ taskId: id, userId })), skipDuplicates: true }),
    ]);
    await this.event(id, actor.userId, 'assigned', { added, removed });
    await this.notify(tenantId, id, actor.userId, added, 'assigned', t.title);
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  // ─── Moving between stages ─────────────────────────────────────────────────

  async move(tenantId: string, id: string, actor: Actor, dto: {
    status?: string; rank?: number; resolution?: string; holdReason?: string | null;
  }) {
    const t = await this.load(tenantId, id, actor);
    const to = (dto.status ?? t.status) as TaskStatus;
    if (!STATUSES.includes(to)) throw new BadRequestException('Unknown stage');
    if (to === 'DONE' || t.status === 'DONE') {
      if (to !== t.status && !this.canClose(t, actor)) {
        throw new ForbiddenException(`Only the task's creator (${t.createdBy.name}) can close or reopen it — move it to Review to suggest closing`);
      }
    } else if (!this.canMove(t, actor)) {
      throw new ForbiddenException('Only the assignees or a manager can move this task');
    }

    if (to !== t.status && ACTIVE.includes(to) && !t.assignees.length) {
      throw new BadRequestException(NEEDS_ASSIGNEE);
    }

    const data: Prisma.TaskUpdateInput = {};
    if (typeof dto.rank === 'number' && Number.isFinite(dto.rank)) data.rank = dto.rank;
    else if (to !== t.status) {
      const top = await this.prisma.task.aggregate({ where: { tenantId, status: to }, _min: { rank: true } });
      data.rank = (top._min.rank ?? 1) - 1;
    }

    let kind: string | null = null;
    if (to !== t.status) {
      data.status = to;
      if (to === 'DONE') {
        const resolution: TaskResolution = dto.resolution === 'WONT_DO' ? 'WONT_DO' : 'DONE';
        data.resolution = resolution;
        data.closedAt = new Date();
        data.closedBy = { connect: { id: actor.userId } };
        kind = 'closed';
      } else if (t.status === 'DONE') {
        data.resolution = null;
        data.closedAt = null;
        data.closedBy = { disconnect: true };
        kind = 'reopened';
      } else {
        kind = 'moved';
      }
      if (to === 'ON_HOLD' && dto.holdReason !== undefined) data.holdReason = (dto.holdReason ?? '').trim().slice(0, 300) || null;
      if (t.status === 'ON_HOLD' && to !== 'ON_HOLD') data.holdReason = null;
    }

    await this.prisma.task.update({ where: { id }, data });
    if (kind) {
      if (kind === 'closed') {
        await this.prisma.taskWait.updateMany({
          where: { taskId: id, resolvedAt: null },
          data: { resolvedAt: new Date(), resolvedById: actor.userId, resolvedReason: 'closed' },
        });
      }
      await this.event(id, actor.userId, kind, { from: t.status, to, resolution: data.resolution ?? null });
      const audience = await this.audience(id);
      if (to === 'REVIEW') {
        // Into REVIEW = a suggestion to close: the creator decides, so they get
        // their own notification; everyone else hears a stage change.
        await this.notify(tenantId, id, actor.userId, [t.createdById], 'suggest_close', t.title);
        await this.notify(tenantId, id, actor.userId, audience.filter((u) => u !== t.createdById), 'status', to);
      } else {
        await this.notify(tenantId, id, actor.userId, audience, kind === 'moved' ? 'status' : kind, to);
      }
    }
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  // ─── Watching ──────────────────────────────────────────────────────────────

  async watch(tenantId: string, id: string, actor: Actor, on: boolean) {
    await this.load(tenantId, id, actor);
    if (on) {
      await this.prisma.taskWatcher.upsert({
        where: { taskId_userId: { taskId: id, userId: actor.userId } },
        create: { taskId: id, userId: actor.userId },
        update: {},
      });
    } else {
      await this.prisma.taskWatcher.deleteMany({ where: { taskId: id, userId: actor.userId } });
    }
    return { watching: on };
  }

  // ─── Thread ────────────────────────────────────────────────────────────────

  async comment(tenantId: string, id: string, actor: Actor, dto: { body?: string; mentionIds?: string[]; waitOnIds?: string[] }) {
    const t = await this.load(tenantId, id, actor);
    const body = (dto.body ?? '').trim();
    if (!body) throw new BadRequestException('Write something first');
    if (body.length > 5000) throw new BadRequestException('Too long (max 5000 characters)');
    const mentions = [...new Set(dto.mentionIds ?? [])].filter((u) => u && u !== actor.userId);
    await this.assertPeople(tenantId, mentions);

    const comment = await this.prisma.taskComment.create({
      data: { taskId: id, authorId: actor.userId, body, mentionIds: mentions },
    });

    // My reply settles whatever the task was waiting on me for.
    await this.prisma.taskWait.updateMany({
      where: { taskId: id, userId: actor.userId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: actor.userId, resolvedReason: 'reply' },
    });

    // A tag does not hand the task over by itself. Only the people the writer
    // ticked ("put the task on them") get a wait — and only among those tagged.
    const waitOn = [...new Set(dto.waitOnIds ?? [])].filter((u) => mentions.includes(u));
    const alreadyWaiting = new Set(t.waits.filter((w) => w.userId !== actor.userId).map((w) => w.userId));
    const newWaits = waitOn.filter((u) => !alreadyWaiting.has(u));
    if (newWaits.length && t.status !== 'DONE') {
      await this.prisma.taskWait.createMany({
        data: newWaits.map((userId) => ({ taskId: id, userId, requestedById: actor.userId, commentId: comment.id })),
      });
      for (const userId of newWaits) await this.event(id, actor.userId, 'waiting', { userId });
    }
    await this.prisma.taskWatcher.createMany({
      data: [...new Set([actor.userId, ...mentions])].map((userId) => ({ taskId: id, userId })),
      skipDuplicates: true,
    });

    const snippet = body.length > 140 ? `${body.slice(0, 140)}…` : body;
    await this.notify(tenantId, id, actor.userId, waitOn, 'waiting', snippet);
    await this.notify(tenantId, id, actor.userId, mentions.filter((u) => !waitOn.includes(u)), 'mention', snippet);
    const others = (await this.audience(id)).filter((u) => !mentions.includes(u));
    await this.notify(tenantId, id, actor.userId, others, 'comment', snippet);
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  /** "Waiting on" set by hand, without writing a comment. */
  async addWait(tenantId: string, id: string, actor: Actor, userId: string) {
    const t = await this.load(tenantId, id, actor);
    if (t.status === 'DONE') throw new BadRequestException('The task is closed');
    if (!userId || userId === actor.userId) throw new BadRequestException('Pick someone else');
    await this.assertPeople(tenantId, [userId]);
    if (!t.waits.some((w) => w.userId === userId)) {
      await this.prisma.taskWait.create({ data: { taskId: id, userId, requestedById: actor.userId } });
      await this.prisma.taskWatcher.createMany({ data: [{ taskId: id, userId }], skipDuplicates: true });
      await this.event(id, actor.userId, 'waiting', { userId });
      await this.notify(tenantId, id, actor.userId, [userId], 'waiting', t.title);
    }
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  /** Clear a wait: the person who asked, or a manager. The waited-on person clears it by replying. */
  async clearWait(tenantId: string, id: string, actor: Actor, waitId: string) {
    await this.load(tenantId, id, actor);
    const w = await this.prisma.taskWait.findFirst({ where: { id: waitId, taskId: id, resolvedAt: null } });
    if (!w) throw new NotFoundException('Nothing to clear');
    if (w.requestedById !== actor.userId && !isTaskManager(actor.role)) {
      throw new ForbiddenException('Only whoever asked, or a manager, can clear this — or reply in the thread');
    }
    await this.prisma.taskWait.update({
      where: { id: waitId },
      data: { resolvedAt: new Date(), resolvedById: actor.userId, resolvedReason: 'cleared' },
    });
    await this.event(id, actor.userId, 'wait_cleared', { userId: w.userId });
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  // ─── Linked records ────────────────────────────────────────────────────────

  /** Lists the caller can link from (the Data lists it may open). */
  async linkTargets(tenantId: string, actor: Actor) {
    const lists = await this.datasets.list(tenantId, actor.role as any);
    return lists.filter((l) => DB_MODELS[l.key] && TABS.find((t) => t.key === l.key)?.source === 'db');
  }

  pickRecords(tenantId: string, actor: Actor, dataset: string, q: string) {
    return this.datasets.pickRecords(tenantId, actor.role as any, dataset, q);
  }

  async addLink(tenantId: string, id: string, actor: Actor, ref: RecordRef) {
    const t = await this.load(tenantId, id, actor);
    if (!this.canMove(t, actor)) throw new ForbiddenException('Only the assignees or a manager can link records');
    const [clean] = this.cleanLinks([ref]);
    if (!clean) throw new BadRequestException('Pick a record');
    await this.datasets.assertLinkable(tenantId, actor.role as any, clean);
    const dup = t.links.some((l) => l.dataset === clean.dataset && l.rowId === clean.rowId && (l.field ?? null) === (clean.field ?? null));
    if (!dup) {
      await this.prisma.taskLink.create({ data: { taskId: id, dataset: clean.dataset, rowId: clean.rowId, field: clean.field ?? null, addedById: actor.userId } });
      await this.event(id, actor.userId, 'linked', { dataset: clean.dataset, rowId: clean.rowId, field: clean.field ?? null });
    }
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  async removeLink(tenantId: string, id: string, actor: Actor, linkId: string) {
    const t = await this.load(tenantId, id, actor);
    const l = t.links.find((x) => x.id === linkId);
    if (!l) throw new NotFoundException('Link not found');
    if (l.addedById !== actor.userId && !isTaskManager(actor.role)) throw new ForbiddenException('Only whoever linked it, or a manager, can remove it');
    await this.prisma.taskLink.delete({ where: { id: linkId } });
    await this.event(id, actor.userId, 'unlinked', { dataset: l.dataset, rowId: l.rowId, field: l.field });
    this.changed(tenantId, id);
    return this.detail(tenantId, id, actor);
  }

  private cleanLinks(raw?: RecordRef[]): RecordRef[] {
    const out: RecordRef[] = [];
    for (const r of (raw ?? []).slice(0, 20)) {
      if (!r || typeof r.dataset !== 'string' || typeof r.rowId !== 'string' || !r.rowId) continue;
      const field = typeof r.field === 'string' && r.field ? r.field : null;
      if (!out.some((o) => o.dataset === r.dataset && o.rowId === r.rowId && (o.field ?? null) === field)) {
        out.push({ dataset: r.dataset, rowId: r.rowId, field });
      }
    }
    return out;
  }

  // ─── The module's own notifications ────────────────────────────────────────

  async notifications(tenantId: string, actor: Actor) {
    const rows = await this.prisma.taskNotification.findMany({
      where: { tenantId, userId: actor.userId },
      include: {
        actor: { select: { id: true, name: true } },
        task: { select: { id: true, number: true, title: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    return rows.map((n) => ({
      id: n.id, kind: n.kind, text: n.text, createdAt: n.createdAt, readAt: n.readAt,
      actor: n.actor, task: { ...n.task, key: `T-${n.task.number}` },
    }));
  }

  async markRead(tenantId: string, actor: Actor, dto: { ids?: string[]; taskId?: string; all?: boolean }) {
    const where: Prisma.TaskNotificationWhereInput = { tenantId, userId: actor.userId, readAt: null };
    if (dto.all) { /* every unread */ }
    else if (dto.taskId) where.taskId = dto.taskId;
    else if (dto.ids?.length) where.id = { in: dto.ids };
    else return { updated: 0 };
    const r = await this.prisma.taskNotification.updateMany({ where, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Everyone who hears about a task: watchers and assignees. */
  private async audience(taskId: string): Promise<string[]> {
    const [w, a] = await Promise.all([
      this.prisma.taskWatcher.findMany({ where: { taskId }, select: { userId: true } }),
      this.prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } }),
    ]);
    return [...new Set([...w, ...a].map((x) => x.userId))];
  }

  private async notify(tenantId: string, taskId: string, actorId: string, userIds: string[], kind: string, text?: string | null) {
    const to = [...new Set(userIds)].filter((u) => u && u !== actorId);
    if (!to.length) return;
    await this.prisma.taskNotification.createMany({
      data: to.map((userId) => ({ tenantId, userId, taskId, actorId, kind, text: text ?? null })),
    });
    for (const u of to) this.gateway.emitToUser(u, 'tasks:notification', { taskId, kind });
  }

  private async event(taskId: string, actorId: string, kind: string, data: Record<string, unknown>) {
    await this.prisma.taskEvent.create({ data: { taskId, actorId, kind, data: data as Prisma.InputJsonValue } });
  }

  /** Boards refresh; non-office sockets get only the id anyway. */
  private changed(tenantId: string, id: string) {
    this.gateway.emitToTenant(tenantId, 'tasks:changed', { id });
  }

  private priority(p?: string): TaskPriority {
    if (p === undefined || p === null || p === '') return 'MEDIUM';
    if (!PRIORITIES.includes(p as TaskPriority)) throw new BadRequestException('Unknown priority');
    return p as TaskPriority;
  }

  private date(d?: string | null): Date | null {
    if (!d) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(`${d}T00:00:00Z`))) throw new BadRequestException('Due date must be YYYY-MM-DD');
    return new Date(`${d}T00:00:00Z`);
  }
}
