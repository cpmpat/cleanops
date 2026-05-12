import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  AuditCategory,
  IncidentPriority,
  IncidentStatus,
  IncidentType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { CleanOpsGateway } from '../websocket/websocket.module';

// ─── DTOs ────────────────────────────────────────────────────

interface CreateIncidentDto {
  type: IncidentType;
  priority?: IncidentPriority;
  title: string;
  description?: string;
  propertyId?: string | null;
  isGeneral?: boolean;
  cleaningId?: string; bookingId?: string;
  assignedToId?: string;
  scheduledFor?: string;
}

interface UpdateIncidentDto {
  type?: IncidentType;
  status?: IncidentStatus;
  priority?: IncidentPriority;
  title?: string;
  description?: string;
  assignedToId?: string | null;
  scheduledFor?: string | null;
  resolutionNote?: string;
}

interface ListIncidentsDto {
  status?: IncidentStatus;
  type?: IncidentType;
  priority?: IncidentPriority;
  propertyId?: string;
  assignedToId?: string;
  cleaningId?: string; bookingId?: string;
  isGeneral?: string | boolean;
  from?: string;
  to?: string;
  limit?: string | number;
  offset?: string | number;
}

interface CreateAttachmentDto {
  url: string;
  mimeType?: string;
}

interface ActorContext {
  userId: string;
  userRole: UserRole | string;
  userEmail?: string;
}

// ─── Includes ────────────────────────────────────────────────

const DETAIL_INCLUDE = {
  property: { select: { id: true, name: true, address: true } },
  reportedBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
  cleaning: {
    select: {
      id: true,
      accommodationName: true,
      bookingRef: true,
      timeSlot: true,
      checkInTime: true,
    },
  },
  attachments: { orderBy: { createdAt: 'asc' as const } },
} as const;

const LIST_INCLUDE = {
  property: { select: { id: true, name: true } },
  reportedBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  _count: { select: { attachments: true } },
} as const;

@Injectable()
export class IncidentsService {
  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
  ) {}

  // ─── CREATE (manager direct) ────────────────────────────────

  async create(tenantId: string, actor: ActorContext, dto: CreateIncidentDto) {
    if (!dto.title?.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!dto.type) {
      throw new BadRequestException('type is required');
    }

    if (dto.propertyId) {
      const prop = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, tenantId },
        select: { id: true },
      });
      if (!prop) throw new NotFoundException('Property not found');
    }

    if (dto.cleaningId) {
      const evt = await this.prisma.cleaning.findFirst({
        where: { id: dto.cleaningId, tenantId },
        select: { id: true },
      });
      if (!evt) throw new NotFoundException('Cleaning not found');
    }

    if (dto.assignedToId) {
      const u = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId, tenantId },
        select: { id: true },
      });
      if (!u) throw new NotFoundException('Assignee not found');
    }

    const incident = await this.prisma.incident.create({
      data: {
        tenantId,
        type: dto.type,
        priority: dto.priority ?? IncidentPriority.MEDIUM,
        status: IncidentStatus.OPEN,
        title: dto.title,
        description: dto.description,
        propertyId: dto.propertyId ?? null,
        isGeneral: dto.isGeneral ?? !dto.propertyId,
        cleaningId: dto.cleaningId ?? null,
        bookingId: dto.bookingId ?? null,
        reportedById: actor.userId,
        assignedToId: dto.assignedToId ?? null,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
      },
      include: DETAIL_INCLUDE,
    });

    await this.writeAudit(tenantId, actor, 'incident.created', incident.id, {
      type: incident.type,
      priority: incident.priority,
      propertyId: incident.propertyId,
    });
    this.gateway.emitToTenant(tenantId, 'incident:created', incident);

    return incident;
  }

  // ─── CREATE (auto from cleaner Done flow) ───────────────────

  async createFromCleaningDone(
    tenantId: string,
    actor: ActorContext,
    params: {
      cleaningId: string;
      priority: IncidentPriority;
      note?: string;
      photoUrls?: string[];
    },
  ) {
    const event = await this.prisma.cleaning.findFirst({
      where: { id: params.cleaningId, tenantId },
      include: { property: { select: { id: true, name: true } } },
    });
    if (!event) throw new NotFoundException('Cleaning not found');

    const note = params.note?.trim();
    const title = note
      ? note.length > 80
        ? `${note.slice(0, 77)}...`
        : note
      : `Issue at ${event.property?.name ?? event.accommodationName}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          tenantId,
          type: IncidentType.CLEANING,
          priority: params.priority,
          status: IncidentStatus.OPEN,
          title,
          description: note || null,
          propertyId: event.propertyId,
          isGeneral: false,
          cleaningId: event.id,
          bookingId: event.bookingId,
          reportedById: actor.userId,
        },
      });

      if (params.photoUrls?.length) {
        await tx.incidentAttachment.createMany({
          data: params.photoUrls.map((url) => ({
            incidentId: incident.id,
            url,
            uploadedById: actor.userId,
          })),
        });
      }

      return incident;
    });

    const full = await this.prisma.incident.findUnique({
      where: { id: created.id },
      include: DETAIL_INCLUDE,
    });

    await this.writeAudit(
      tenantId,
      actor,
      'incident.created_from_cleaning',
      created.id,
      {
        cleaningId: params.cleaningId,
        accommodationName: event.accommodationName,
        priority: params.priority,
        photoCount: params.photoUrls?.length ?? 0,
      },
    );
    this.gateway.emitToTenant(tenantId, 'incident:created', full);

    return full!;
  }

  // ─── LIST (role-scoped: cleaner sees own, manager sees all) ─

  async list(
    tenantId: string,
    actor: ActorContext,
    filters: ListIncidentsDto,
  ) {
    const where: Prisma.IncidentWhereInput = { tenantId };

    if (actor.userRole === UserRole.CLEANER) {
      where.reportedById = actor.userId;
    }

    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.priority) where.priority = filters.priority;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters.cleaningId) where.cleaningId = filters.cleaningId;
    if (filters.isGeneral !== undefined) {
      where.isGeneral =
        filters.isGeneral === true || filters.isGeneral === 'true';
    }
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const limit = Math.min(Number(filters.limit) || 50, 100);
    const offset = Number(filters.offset) || 0;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.incident.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.incident.count({ where }),
    ]);

    return { rows, total, limit, offset };
  }

  // ─── GET (role-scoped) ──────────────────────────────────────

  async get(tenantId: string, actor: ActorContext, id: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, tenantId },
      include: DETAIL_INCLUDE,
    });
    if (!incident) throw new NotFoundException('Incident not found');
    if (
      actor.userRole === UserRole.CLEANER &&
      incident.reportedById !== actor.userId
    ) {
      throw new ForbiddenException('Not your incident');
    }
    return incident;
  }

  // ─── UPDATE (manager only — enforced at controller) ─────────

  async update(
    tenantId: string,
    actor: ActorContext,
    id: string,
    dto: UpdateIncidentDto,
  ) {
    const existing = await this.prisma.incident.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Incident not found');

    if (dto.assignedToId) {
      const u = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId, tenantId },
        select: { id: true },
      });
      if (!u) throw new NotFoundException('Assignee not found');
    }

    const data: Prisma.IncidentUpdateInput = {};
    let statusChanged = false;
    let prevStatus: IncidentStatus | null = null;

    if (dto.type !== undefined) data.type = dto.type;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.resolutionNote !== undefined) data.resolutionNote = dto.resolutionNote;
    if (dto.scheduledFor !== undefined) {
      data.scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    }
    if (dto.assignedToId !== undefined) {
      data.assignedTo = dto.assignedToId
        ? { connect: { id: dto.assignedToId } }
        : { disconnect: true };
    }

    if (dto.status !== undefined && dto.status !== existing.status) {
      statusChanged = true;
      prevStatus = existing.status;
      data.status = dto.status;

      if (
        dto.status === IncidentStatus.RESOLVED &&
        existing.status !== IncidentStatus.RESOLVED
      ) {
        data.resolvedAt = new Date();
        data.resolvedBy = { connect: { id: actor.userId } };
      }
      if (
        dto.status !== IncidentStatus.RESOLVED &&
        dto.status !== IncidentStatus.CLOSED
      ) {
        data.resolvedAt = null;
        if (existing.resolvedById) {
          data.resolvedBy = { disconnect: true };
        }
      }
    }

    const updated = await this.prisma.incident.update({
      where: { id },
      data,
      include: DETAIL_INCLUDE,
    });

    if (statusChanged) {
      await this.writeAudit(
        tenantId,
        actor,
        'incident.status_changed',
        id,
        { from: prevStatus, to: updated.status },
      );

      // Notify the original reporter if the status moved
      if (updated.reportedById && updated.reportedById !== actor.userId) {
        await this.prisma.notification.create({
          data: {
            tenantId,
            userId: updated.reportedById,
            type: 'INCIDENT_UPDATE' as any,
            channel: 'IN_APP',
            title: 'Incident update',
            body: `Your report "${updated.title}" is now ${updated.status}.`,
            payload: { incidentId: id, status: updated.status },
          },
        });
        this.gateway.emitToUser(updated.reportedById, 'incident:updated', updated);
      }
    } else {
      await this.writeAudit(tenantId, actor, 'incident.updated', id, {
        fields: Object.keys(dto),
      });
    }

    this.gateway.emitToTenant(tenantId, 'incident:updated', updated);

    return updated;
  }

  // ─── ATTACHMENTS ────────────────────────────────────────────

  async addAttachment(
    tenantId: string,
    actor: ActorContext,
    incidentId: string,
    dto: CreateAttachmentDto,
  ) {
    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, tenantId },
      select: { id: true },
    });
    if (!incident) throw new NotFoundException('Incident not found');

    if (!dto.url || typeof dto.url !== 'string') {
      throw new BadRequestException('url is required');
    }

    const attachment = await this.prisma.incidentAttachment.create({
      data: {
        incidentId,
        url: dto.url,
        mimeType: dto.mimeType ?? null,
        uploadedById: actor.userId,
      },
    });

    await this.writeAudit(
      tenantId,
      actor,
      'incident.attachment_added',
      incidentId,
      { attachmentId: attachment.id },
    );

    const full = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: DETAIL_INCLUDE,
    });
    this.gateway.emitToTenant(tenantId, 'incident:updated', full);

    return attachment;
  }

  async deleteAttachment(
    tenantId: string,
    actor: ActorContext,
    incidentId: string,
    attachmentId: string,
  ) {
    const attachment = await this.prisma.incidentAttachment.findFirst({
      where: {
        id: attachmentId,
        incidentId,
        incident: { tenantId },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    await this.prisma.incidentAttachment.delete({
      where: { id: attachmentId },
    });

    await this.writeAudit(
      tenantId,
      actor,
      'incident.attachment_removed',
      incidentId,
      { attachmentId },
    );

    const full = await this.prisma.incident.findUnique({
      where: { id: incidentId },
      include: DETAIL_INCLUDE,
    });
    this.gateway.emitToTenant(tenantId, 'incident:updated', full);

    return { deleted: true };
  }

  // ─── Helpers ────────────────────────────────────────────────

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
        category: AuditCategory.INCIDENT_LIFECYCLE,
        action,
        actorId: actor.userId,
        actorEmail: actor.userEmail ?? null,
        targetType: 'Incident',
        targetId,
        metadata: metadata as any,
      },
    });
  }
}
