import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  AuditCategory,
  BookingStatus,
  IncidentType,
  Prisma,
  StreamEventCategory,
  UserRole,
} from '@prisma/client';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { FULL_EDIT_ROLES } from '../datasets/datasets.service';

// ─── Types ──────────────────────────────────────────────────

export type StreamItemType =
  | 'RESERVATION'
  | 'CLEANING'
  /** The turnover model — what the cleaning pool actually runs on. */
  | 'TURNOVER'
  /** A chat the office started with people; not tied to any cleaning. */
  | 'DIRECT_CHAT'
  | 'INCIDENT'
  | 'REPAIR'
  | 'INSPECTION'
  | 'MANUAL'
  /** An accommodation's Pricing Group moved (pricing_group_moves). */
  | 'PRICING';

export interface StreamItem {
  id: string;
  type: StreamItemType;
  occurredAt: string;
  propertyId: string | null;
  propertyName: string | null;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string;
  photoUrls?: string[];
  status?: string;
  priority?: string;
  /**
   * Set on TURNOVER items that have a chat. The exchange belongs to the
   * cleaning, so it is a property of that record rather than a line of its
   * own — one turnover, one entry, with a hint that there was talking.
   */
  chat?: {
    id: string;
    messageCount: number;
    participantCount: number;
    lastMessageAt: string | null;
    lastMessage?: string | null;
  };
  source: {
    kind: 'booking' | 'cleaning' | 'turnover' | 'direct_chat' | 'incident' | 'manual' | 'pricing';
    id: string;
  };
  authorName?: string;
  /** PRICING only: which way the Pricing Group moved. */
  move?: 'UP' | 'DOWN' | 'SET' | 'CLEARED' | 'SAME' | 'UNRANKED';
}

interface CreateManualDto {
  category?: StreamEventCategory;
  title: string;
  description?: string;
  propertyId?: string | null;
  photoUrls?: string[];
  occurredAt?: string;
}

interface UpdateManualDto {
  category?: StreamEventCategory;
  title?: string;
  description?: string;
  propertyId?: string | null;
  photoUrls?: string[];
  occurredAt?: string;
}

interface FeedQuery {
  /** One property — kept for the per-property drill-down page. */
  propertyId?: string;
  /** Comma-separated property ids. Unioned with `propertyId` if both arrive. */
  propertyIds?: string;
  cursor?: string;
  limit?: string | number;
  types?: string;
  from?: string;
  to?: string;
}

interface ActorContext {
  userId: string;
  userRole: UserRole | string;
  userEmail?: string;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const OVERFETCH_PER_SOURCE = 2;

@Injectable()
export class StreamsService {
  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
  ) {}

  // ─── FEED AGGREGATION ──────────────────────────────────────

  async getFeed(tenantId: string, q: FeedQuery, role?: string): Promise<{
    items: StreamItem[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(Number(q.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const cursor = q.cursor ? new Date(q.cursor) : null;
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;

    const requestedTypes = q.types
      ? (q.types.split(',').map((s) => s.trim().toUpperCase()) as StreamItemType[])
      : null;

    // One filter, however it arrived: `propertyId` from the drill-down page,
    // `propertyIds` from the unit picker on the feed.
    const propertyIds = [
      ...(q.propertyId ? [q.propertyId] : []),
      ...(q.propertyIds ? q.propertyIds.split(',').map((s) => s.trim()) : []),
    ].filter(Boolean);
    const scoped = propertyIds.length > 0 ? propertyIds : null;

    const fetchSize = limit * OVERFETCH_PER_SOURCE;

    const [reservations, cleanings, turnovers, directChats, incidents, manuals, pricing] =
      await Promise.all([
        this.fetchReservations(tenantId, scoped, cursor, from, to, fetchSize),
        this.fetchCleanings(tenantId, scoped, cursor, from, to, fetchSize),
        this.fetchTurnovers(tenantId, scoped, cursor, from, to, fetchSize),
        // Direct chats carry no property at all — `propertyId` is null on every
        // one of them. Letting them through a unit filter would put messages
        // about flat B in a feed the user has narrowed to flat A, which reads
        // as a bug in the filter rather than a property of the data.
        scoped ? Promise.resolve([]) : this.fetchDirectChats(tenantId, cursor, from, to, fetchSize),
        this.fetchIncidents(tenantId, scoped, cursor, from, to, fetchSize),
        this.fetchManualEvents(tenantId, scoped, cursor, from, to, fetchSize),
        this.fetchPricingMoves(tenantId, role, scoped, cursor, from, to, fetchSize),
      ]);

    let merged: StreamItem[] = [
      ...reservations,
      ...cleanings,
      ...turnovers,
      ...directChats,
      ...incidents,
      ...manuals,
      ...pricing,
    ];

    if (requestedTypes) {
      merged = merged.filter((it) => requestedTypes.includes(it.type));
    }

    merged.sort((a, b) => {
      const tb = b.occurredAt.localeCompare(a.occurredAt);
      return tb !== 0 ? tb : b.id.localeCompare(a.id);
    });

    const sliced = merged.slice(0, limit);
    const nextCursor = sliced.length === limit
      ? sliced[sliced.length - 1].occurredAt
      : null;

    return { items: sliced, nextCursor };
  }

  // ─── SOURCE 1: Bookings → RESERVATION items ──────────────

  private async fetchReservations(
    tenantId: string,
    propertyIds: string[] | null,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.BookingWhereInput = { tenantId };
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (cursor || from || to) {
      where.checkInTime = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.booking.findMany({
      where,
      include: { property: { select: { id: true, name: true } } },
      orderBy: { checkInTime: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => {
      const propertyName = r.property?.name ?? r.accommodationName;
      const guestCount = r.numAdults + r.numChildren;
      const isCancelled = r.status === BookingStatus.CANCELLED;

      return {
        id: `res-${r.id}`,
        type: 'RESERVATION' as const,
        occurredAt: r.checkInTime.toISOString(),
        propertyId: r.propertyId,
        propertyName,
        title: isCancelled
          ? `Cancelled: ${propertyName}`
          : `Check-in: ${propertyName}`,
        subtitle:
          guestCount > 1
            ? `${guestCount} guests · ref ${r.bookingRef}`
            : `ref ${r.bookingRef}`,
        status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
        source: { kind: 'booking' as const, id: r.id },
      };
    });
  }

  // ─── SOURCE 2: Cleanings → CLEANING items ────────────────

  private async fetchCleanings(
    tenantId: string,
    propertyIds: string[] | null,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.CleaningWhereInput = { tenantId };
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (cursor || from || to) {
      where.timeSlot = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.cleaning.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        booking: { select: { bookingRef: true } },
      },
      orderBy: { timeSlot: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => ({
      id: `cln-${r.id}`,
      type: 'CLEANING' as const,
      occurredAt: r.timeSlot.toISOString(),
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? r.accommodationName,
      title: `Cleaning: ${r.accommodationName}`,
      subtitle: r.booking?.bookingRef
        ? `ref ${r.booking.bookingRef}${r.bookingCancelledAt ? ' (booking cancelled)' : ''}`
        : undefined,
      status: r.status,
      source: { kind: 'cleaning' as const, id: r.id },
    }));
  }

  // ─── SOURCE 2b: Turnovers → TURNOVER items ───────────────

  /**
   * The real cleaning model. `fetchCleanings` above reads the legacy table,
   * which is empty for anything the pool produced — without this source the
   * stream shows bookings and incidents but not the work between them.
   */
  private async fetchTurnovers(
    tenantId: string,
    propertyIds: string[] | null,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.TurnoverWhereInput = { tenantId, supersededById: null };
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (cursor || from || to) {
      where.createdAt = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.turnover.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        toBooking: { select: { bookingRef: true, checkInTime: true } },
        assignments: {
          where: { status: { in: ['ASSIGNED', 'STARTED', 'COMPLETED'] } },
          select: { user: { select: { name: true } } },
        },
        conversations: {
          where: { kind: 'TURNOVER' },
          select: {
            id: true,
            lastMessageAt: true,
            _count: { select: { messages: true, members: true } },
            messages: {
              where: { kind: 'TEXT' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { body: true, author: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => {
      const chat = r.conversations[0];
      const lastChatMessage = chat?.messages?.[0];
      return {
      id: `trn-${r.id}`,
      type: 'TURNOVER' as const,
      // The moment the work appeared, which is what a timeline is about.
      occurredAt: (r.availableFrom ?? r.createdAt).toISOString(),
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? null,
      title: `Turnover: ${r.property?.name ?? ''}`.trim(),
      subtitle: [
        r.toBooking?.bookingRef ? `ref ${r.toBooking.bookingRef}` : null,
        r.assignments[0]?.user?.name ?? null,
      ].filter(Boolean).join(' · ') || undefined,
      status: r.status,
      source: { kind: 'turnover' as const, id: r.id },
      authorName: r.assignments[0]?.user?.name,
      chat: chat
        ? {
            id: chat.id,
            // The system line that opens every channel is not a conversation.
            messageCount: Math.max(0, chat._count.messages - 1),
            participantCount: chat._count.members,
            lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
            lastMessage: lastChatMessage
              ? `${lastChatMessage.author?.name ? `${lastChatMessage.author.name}: ` : ''}` +
                `${(lastChatMessage.body ?? '📷').slice(0, 80)}`
              : null,
          }
        : undefined,
      };
    });
  }

  // ─── SOURCE 2c: Direct chats → DIRECT_CHAT items ─────────

  /**
   * Only the office-initiated chats. A chat about a cleaning is reported on the
   * turnover itself (see `chat` above) — showing it twice would double-count
   * the same event and split the story of one flat across two lines.
   */
  private async fetchDirectChats(
    tenantId: string,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: any = { tenantId, kind: 'DIRECT' };
    if (cursor || from || to) {
      where.createdAt = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.conversation.findMany({
      where,
      include: {
        createdBy: { select: { name: true } },
        members: { select: { user: { select: { name: true } } } },
        _count: { select: { messages: true, members: true } },
        messages: {
          where: { kind: 'TEXT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, author: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => {
      const last = r.messages[0];
      const names = r.members.map((mem) => mem.user?.name).filter(Boolean);
      return {
        id: `cht-${r.id}`,
        type: 'DIRECT_CHAT' as const,
        occurredAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
        propertyId: null,
        propertyName: null,
        title: r.title ?? `Chat: ${names.slice(0, 3).join(', ')}`,
        subtitle: last
          ? `${last.author?.name ? `${last.author.name}: ` : ''}${(last.body ?? '📷').slice(0, 90)}`
          : `${names.length} účastníků`,
        status: r.archivedAt ? 'ARCHIVED' : r.status,
        source: { kind: 'direct_chat' as const, id: r.id },
        authorName: r.createdBy?.name,
      };
    });
  }

  // ─── SOURCE 3: Incidents → INCIDENT/REPAIR/INSPECTION ───

  private async fetchIncidents(
    tenantId: string,
    propertyIds: string[] | null,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.IncidentWhereInput = { tenantId };
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (cursor || from || to) {
      where.createdAt = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.incident.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        attachments: { take: 1, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => ({
      id: `inc-${r.id}`,
      type: this.mapIncidentTypeToStreamType(r.type),
      occurredAt: r.createdAt.toISOString(),
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? null,
      title: r.title,
      subtitle: r.description?.slice(0, 120),
      thumbnailUrl: r.attachments[0]?.url,
      status: r.status,
      priority: r.priority,
      source: { kind: 'incident' as const, id: r.id },
    }));
  }

  private mapIncidentTypeToStreamType(t: IncidentType): StreamItemType {
    switch (t) {
      case 'REPAIR':
        return 'REPAIR';
      case 'BOILER_INSPECTION':
        return 'INSPECTION';
      default:
        return 'INCIDENT';
    }
  }

  // ─── SOURCE 4: Manual events ─────────────────────────────

  private async fetchManualEvents(
    tenantId: string,
    propertyIds: string[] | null,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.ManualStreamEventWhereInput = { tenantId };
    if (propertyIds?.length) where.propertyId = { in: propertyIds };
    if (cursor || from || to) {
      where.occurredAt = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.manualStreamEvent.findMany({
      where,
      include: {
        property: { select: { id: true, name: true } },
        author: { select: { id: true, name: true, email: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => ({
      id: `man-${r.id}`,
      type: this.mapManualCategoryToStreamType(r.category),
      occurredAt: r.occurredAt.toISOString(),
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? null,
      title: r.title,
      subtitle: r.description?.slice(0, 120),
      thumbnailUrl: r.photoUrls[0],
      photoUrls: r.photoUrls,
      authorName: r.author.name,
      source: { kind: 'manual' as const, id: r.id },
    }));
  }

  // ─── SOURCE: Pricing Group moves → PRICING items ───────────
  //
  // Written by a database trigger for every recorded change of
  // accommodation.pricingGroup. Shown only to roles that may see that column
  // in Data. A move whose unit had no Avantio property when it was written is
  // matched again by idAvantio here, so it lands on the unit once it exists.

  private async fetchPricingMoves(
    tenantId: string,
    role: string | undefined,
    propertyIds: string[] | null,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    if (!role) return [];
    if (!FULL_EDIT_ROLES.includes(role)) {
      const grant = await this.prisma.datasetFieldAccess.findFirst({
        where: { tenantId, role: role as UserRole, dataset: 'accommodation', field: 'pricingGroup', canView: true },
        select: { field: true },
      });
      if (!grant) return [];
    }

    const where: Prisma.PricingGroupMoveWhereInput = {
      tenantId,
      direction: { notIn: ['SAME', 'CLEARED'] },
    };
    if (propertyIds?.length) {
      const props = await this.prisma.property.findMany({
        where: { tenantId, id: { in: propertyIds } },
        select: { pmsPropertyId: true },
      });
      const pms = props.map((p) => p.pmsPropertyId).filter((x): x is string => !!x);
      where.OR = [{ propertyId: { in: propertyIds } }, ...(pms.length ? [{ idAvantio: { in: pms } }] : [])];
    }
    if (cursor || from || to) {
      where.occurredAt = {
        ...(cursor ? { lt: cursor } : {}),
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const rows = await this.prisma.pricingGroupMove.findMany({
      where,
      include: { property: { select: { id: true, name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: fetchSize,
    });

    // Units written before their property existed.
    const missing = [...new Set(rows.filter((r) => !r.propertyId && r.idAvantio).map((r) => r.idAvantio!))];
    const late = missing.length
      ? new Map(
          (await this.prisma.property.findMany({
            where: { tenantId, pmsPropertyId: { in: missing } },
            select: { id: true, name: true, pmsPropertyId: true },
          })).map((p) => [p.pmsPropertyId!, p]),
        )
      : new Map<string, { id: string; name: string }>();

    const word: Record<string, string> = {
      UP: 'nahoru', DOWN: 'dolů', SET: 'nastavena', UNRANKED: 'změněna',
    };
    return rows.map((r) => {
      const prop = r.property ?? (r.idAvantio ? late.get(r.idAvantio) : undefined) ?? null;
      const name = prop?.name ?? r.accommodationTitle ?? null;
      return {
        id: `prc-${r.id}`,
        type: 'PRICING' as const,
        occurredAt: r.occurredAt.toISOString(),
        propertyId: prop?.id ?? null,
        propertyName: name,
        title: r.fromGroup ? `Cenová skupina: ${r.fromGroup} → ${r.toGroup}` : `Cenová skupina: ${r.toGroup}`,
        subtitle: `Cenová skupina ${word[r.direction] ?? r.direction.toLowerCase()}`,
        status: r.direction,
        move: r.direction as StreamItem['move'],
        authorName: r.actorRole === 'IMPORT' ? 'ze sheetu' : r.actorEmail ?? undefined,
        source: { kind: 'pricing' as const, id: r.changeId },
      };
    });
  }

  private mapManualCategoryToStreamType(c: StreamEventCategory): StreamItemType {
    switch (c) {
      case 'REPAIR':
        return 'REPAIR';
      case 'INSPECTION':
        return 'INSPECTION';
      default:
        return 'MANUAL';
    }
  }

  // ─── MANUAL EVENT CRUD ─────────────────────────────────────

  async createManual(tenantId: string, actor: ActorContext, dto: CreateManualDto) {
    if (!dto.title?.trim()) throw new BadRequestException('title is required');

    if (dto.propertyId) {
      const prop = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, tenantId },
        select: { id: true },
      });
      if (!prop) throw new NotFoundException('Property not found');
    }

    const created = await this.prisma.manualStreamEvent.create({
      data: {
        tenantId,
        propertyId: dto.propertyId ?? null,
        authorId: actor.userId,
        category: dto.category ?? StreamEventCategory.MANUAL,
        title: dto.title.trim(),
        description: dto.description ?? null,
        photoUrls: dto.photoUrls ?? [],
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      },
      include: {
        property: { select: { id: true, name: true } },
        author: { select: { id: true, name: true, email: true } },
      },
    });

    await this.writeAudit(tenantId, actor, 'stream.manual_created', created.id, {
      category: created.category,
      propertyId: created.propertyId,
    });
    this.gateway.emitToTenant(tenantId, 'stream:created', created);

    return created;
  }

  async updateManual(
    tenantId: string,
    actor: ActorContext,
    id: string,
    dto: UpdateManualDto,
  ) {
    const existing = await this.prisma.manualStreamEvent.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Event not found');

    if (
      actor.userRole !== UserRole.MANAGER &&
      existing.authorId !== actor.userId
    ) {
      throw new ForbiddenException('Not your event');
    }

    if (dto.propertyId !== undefined && dto.propertyId !== null) {
      const prop = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, tenantId },
        select: { id: true },
      });
      if (!prop) throw new NotFoundException('Property not found');
    }

    const updated = await this.prisma.manualStreamEvent.update({
      where: { id },
      data: {
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.propertyId !== undefined && { propertyId: dto.propertyId }),
        ...(dto.photoUrls !== undefined && { photoUrls: dto.photoUrls }),
        ...(dto.occurredAt !== undefined && { occurredAt: new Date(dto.occurredAt) }),
      },
      include: {
        property: { select: { id: true, name: true } },
        author: { select: { id: true, name: true, email: true } },
      },
    });

    await this.writeAudit(tenantId, actor, 'stream.manual_updated', id, {
      fields: Object.keys(dto),
    });
    this.gateway.emitToTenant(tenantId, 'stream:updated', updated);

    return updated;
  }

  async deleteManual(tenantId: string, actor: ActorContext, id: string) {
    const existing = await this.prisma.manualStreamEvent.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Event not found');

    if (
      actor.userRole !== UserRole.MANAGER &&
      existing.authorId !== actor.userId
    ) {
      throw new ForbiddenException('Not your event');
    }

    await this.prisma.manualStreamEvent.delete({ where: { id } });
    await this.writeAudit(tenantId, actor, 'stream.manual_deleted', id, {});
    this.gateway.emitToTenant(tenantId, 'stream:deleted', { id });

    return { deleted: true };
  }

  // ─── Helpers ───────────────────────────────────────────────

  private async writeAudit(
    tenantId: string,
    actor: ActorContext,
    action: string,
    targetId: string,
    metadata: Record<string, any>,
  ) {
    await this.prisma.auditEvent.create({
      data: {
        tenantId,
        category: AuditCategory.SYSTEM,
        action,
        actorId: actor.userId,
        actorEmail: actor.userEmail ?? null,
        targetType: 'ManualStreamEvent',
        targetId,
        metadata: metadata as any,
      },
    });
  }
}
