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

// ─── Types ──────────────────────────────────────────────────

export type StreamItemType =
  | 'RESERVATION'
  | 'CLEANING'
  /** The turnover model — what the cleaning pool actually runs on. */
  | 'TURNOVER'
  /** A thread somebody opened on a turnover. */
  | 'TURNOVER_CHAT'
  | 'INCIDENT'
  | 'REPAIR'
  | 'INSPECTION'
  | 'MANUAL';

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
  source: {
    kind: 'booking' | 'cleaning' | 'turnover' | 'turnover_chat' | 'incident' | 'manual';
    id: string;
  };
  authorName?: string;
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
  propertyId?: string;
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

  async getFeed(tenantId: string, q: FeedQuery): Promise<{
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

    const fetchSize = limit * OVERFETCH_PER_SOURCE;

    const [reservations, cleanings, turnovers, chats, incidents, manuals] =
      await Promise.all([
        this.fetchReservations(tenantId, q.propertyId, cursor, from, to, fetchSize),
        this.fetchCleanings(tenantId, q.propertyId, cursor, from, to, fetchSize),
        this.fetchTurnovers(tenantId, q.propertyId, cursor, from, to, fetchSize),
        this.fetchTurnoverChats(tenantId, q.propertyId, cursor, from, to, fetchSize),
        this.fetchIncidents(tenantId, q.propertyId, cursor, from, to, fetchSize),
        this.fetchManualEvents(tenantId, q.propertyId, cursor, from, to, fetchSize),
      ]);

    let merged: StreamItem[] = [
      ...reservations,
      ...cleanings,
      ...turnovers,
      ...chats,
      ...incidents,
      ...manuals,
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
    propertyId: string | undefined,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.BookingWhereInput = { tenantId };
    if (propertyId) where.propertyId = propertyId;
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
    propertyId: string | undefined,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.CleaningWhereInput = { tenantId };
    if (propertyId) where.propertyId = propertyId;
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
    propertyId: string | undefined,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.TurnoverWhereInput = { tenantId, supersededById: null };
    if (propertyId) where.propertyId = propertyId;
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
      },
      orderBy: { createdAt: 'desc' },
      take: fetchSize,
    });

    return rows.map((r) => ({
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
    }));
  }

  // ─── SOURCE 2c: Turnover chats → TURNOVER_CHAT items ─────

  private async fetchTurnoverChats(
    tenantId: string,
    propertyId: string | undefined,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: any = { tenantId };
    if (propertyId) where.turnover = { propertyId };
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
        turnover: { select: { propertyId: true, property: { select: { id: true, name: true } } } },
        createdBy: { select: { name: true } },
        _count: { select: { messages: true } },
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
      return {
        id: `cht-${r.id}`,
        type: 'TURNOVER_CHAT' as const,
        occurredAt: (r.lastMessageAt ?? r.createdAt).toISOString(),
        propertyId: r.turnover?.propertyId ?? null,
        propertyName: r.turnover?.property?.name ?? null,
        title: `Chat: ${r.turnover?.property?.name ?? ''}`.trim(),
        subtitle: last
          ? `${last.author?.name ? `${last.author.name}: ` : ''}${(last.body ?? '📷').slice(0, 90)}`
          : `${r._count.messages} messages`,
        status: r.archivedAt ? 'ARCHIVED' : r.status,
        source: { kind: 'turnover_chat' as const, id: r.id },
        authorName: r.createdBy?.name,
      };
    });
  }

  // ─── SOURCE 3: Incidents → INCIDENT/REPAIR/INSPECTION ───

  private async fetchIncidents(
    tenantId: string,
    propertyId: string | undefined,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.IncidentWhereInput = { tenantId };
    if (propertyId) where.propertyId = propertyId;
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
    propertyId: string | undefined,
    cursor: Date | null,
    from: Date | null,
    to: Date | null,
    fetchSize: number,
  ): Promise<StreamItem[]> {
    const where: Prisma.ManualStreamEventWhereInput = { tenantId };
    if (propertyId) where.propertyId = propertyId;
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
