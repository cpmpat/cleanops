import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  RepairStatus,
  RepairAssignmentStatus,
  RepairAuthorRole,
  RepairReportUrgency,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

// ─── DTOs ───────────────────────────────────────────────────────────

export interface CreateRepairDto {
  title: string;
  description?: string;
  propertyId: string;
  dueDate: string; // ISO
  assignTo?: string[]; // optional userIds — if given, repair starts ASSIGNED
  primaryUserId?: string; // optional — which assignee is primary
}

export interface CreateRepairFromIncidentDto {
  title?: string;       // defaults to incident.title
  description?: string; // defaults to incident.description
  dueDate: string;
  assignTo?: string[];
  primaryUserId?: string;
}

export interface UpdateRepairDto {
  title?: string;
  description?: string;
  dueDate?: string;
  propertyId?: string;
}

export interface AssignRepairDto {
  userIds: string[];          // all assignees (replaces current active set)
  primaryUserId?: string;     // which one is primary
}

export interface SubmitDoneDto {
  comment?: string;
  materials?: Array<{ materialId: string; amount: number; note?: string }>;
  photoUrls?: string[];
}

export interface ReportProblemDto {
  urgency: RepairReportUrgency;
  description: string;
  photoUrls?: string[];
}

// ─── Includes (shared) ──────────────────────────────────────────────

const REPAIR_INCLUDE = {
  property: { select: { id: true, name: true, address: true } },
  assignments: {
    where: { status: { in: ['ASSIGNED', 'STARTED'] as RepairAssignmentStatus[] } },
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  materials: {
    include: {
      material: { select: { id: true, name: true, unit: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  photos: {
    orderBy: { uploadedAt: 'desc' as const },
    take: 50,
  },
  reports: {
    orderBy: { createdAt: 'desc' as const },
    include: { author: { select: { id: true, name: true } } },
  },
  incident: { select: { id: true, title: true, type: true, status: true } },
};

// ─── Service ────────────────────────────────────────────────────────

@Injectable()
export class RepairsService {
  private readonly logger = new Logger(RepairsService.name);

  constructor(private prisma: PrismaService) {}

  // ============================================================
  // CREATE
  // ============================================================

  async createManual(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    dto: CreateRepairDto,
  ) {
    this.requireManager(actor.userRole);
    this.validateRepairBasics(dto.title, dto.description, dto.dueDate, dto.propertyId);

    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, tenantId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const willAssign = dto.assignTo && dto.assignTo.length > 0;

    return this.prisma.$transaction(async (tx) => {
      const repair = await tx.repair.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          dueDate: new Date(dto.dueDate),
          status: willAssign ? 'ASSIGNED' : 'PLANNED',
        },
      });

      if (willAssign) {
        await this.assignInTx(tx, repair.id, dto.assignTo!, dto.primaryUserId, actor.userId);
      }

      await this.audit(tx, tenantId, actor, 'repair.created', repair.id, {
        title: repair.title,
        assignedTo: dto.assignTo ?? [],
      });

      return tx.repair.findUnique({
        where: { id: repair.id },
        include: REPAIR_INCLUDE,
      });
    });
  }

  async createFromIncident(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    incidentId: string,
    dto: CreateRepairFromIncidentDto,
  ) {
    this.requireManager(actor.userRole);

    const incident = await this.prisma.incident.findFirst({
      where: { id: incidentId, tenantId },
      include: { repair: true },
    });
    if (!incident) throw new NotFoundException('Incident not found');
    if (incident.repair) {
      throw new ConflictException('This incident already has a linked repair');
    }
    if (!incident.propertyId) {
      throw new BadRequestException(
        'Incident has no property — cannot create repair from a tenant-wide incident',
      );
    }

    const title = (dto.title || incident.title).trim();
    const description = (dto.description ?? incident.description ?? '').trim() || null;
    this.validateRepairBasics(title, description, dto.dueDate, incident.propertyId);

    const willAssign = dto.assignTo && dto.assignTo.length > 0;

    return this.prisma.$transaction(async (tx) => {
      const repair = await tx.repair.create({
        data: {
          tenantId,
          propertyId: incident.propertyId!,
          incidentId,
          title,
          description,
          dueDate: new Date(dto.dueDate),
          status: willAssign ? 'ASSIGNED' : 'PLANNED',
        },
      });

      if (willAssign) {
        await this.assignInTx(tx, repair.id, dto.assignTo!, dto.primaryUserId, actor.userId);
      }

      // Auto-update incident status to SCHEDULED (it's now in the repair workflow)
      await tx.incident.update({
        where: { id: incidentId },
        data: { status: 'SCHEDULED' },
      });

      await this.audit(tx, tenantId, actor, 'repair.created_from_incident', repair.id, {
        incidentId,
        title,
      });

      return tx.repair.findUnique({
        where: { id: repair.id },
        include: REPAIR_INCLUDE,
      });
    });
  }

  // ============================================================
  // LIST / GET
  // ============================================================

  async list(
    tenantId: string,
    filters: {
      status?: RepairStatus | RepairStatus[];
      propertyId?: string;
      assignedToId?: string;
      due?: 'overdue' | 'today' | 'week' | 'all';
    } = {},
  ) {
    const where: any = { tenantId };

    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    if (filters.propertyId) where.propertyId = filters.propertyId;

    if (filters.assignedToId) {
      where.assignments = {
        some: {
          userId: filters.assignedToId,
          status: { in: ['ASSIGNED', 'STARTED'] },
        },
      };
    }

    const now = new Date();
    if (filters.due === 'overdue') {
      where.dueDate = { lt: now };
      where.status = { notIn: ['DONE', 'CANCELLED'] };
    } else if (filters.due === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      where.dueDate = { gte: start, lte: end };
    } else if (filters.due === 'week') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      where.dueDate = { gte: start, lte: end };
    }

    return this.prisma.repair.findMany({
      where,
      include: REPAIR_INCLUDE,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: 200,
    });
  }

  async listMine(tenantId: string, userId: string) {
    return this.prisma.repair.findMany({
      where: {
        tenantId,
        assignments: {
          some: { userId, status: { in: ['ASSIGNED', 'STARTED'] } },
        },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      include: REPAIR_INCLUDE,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
  }

  async getById(tenantId: string, id: string, actor?: { userId: string; userRole: UserRole }) {
    const repair = await this.prisma.repair.findFirst({
      where: { id, tenantId },
      include: {
        ...REPAIR_INCLUDE,
        comments: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!repair) throw new NotFoundException('Repair not found');

    // Repairmen can only see repairs they're assigned to
    if (actor && actor.userRole === 'REPAIRMAN') {
      const isAssigned = repair.assignments.some((a) => a.user.id === actor.userId);
      if (!isAssigned) {
        throw new ForbiddenException('You are not assigned to this repair');
      }
    }

    return repair;
  }

  // ============================================================
  // UPDATE / CANCEL (manager)
  // ============================================================

  async update(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    id: string,
    dto: UpdateRepairDto,
  ) {
    this.requireManager(actor.userRole);

    const existing = await this.prisma.repair.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Repair not found');
    if (existing.status === 'DONE') {
      throw new BadRequestException('Cannot edit a completed repair');
    }
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('Cannot edit a cancelled repair');
    }

    if (dto.propertyId && dto.propertyId !== existing.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, tenantId },
      });
      if (!property) throw new NotFoundException('Property not found');
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (dto.propertyId !== undefined) data.propertyId = dto.propertyId;

    if (data.title !== undefined && (data.title.length < 3 || data.title.length > 200)) {
      throw new BadRequestException('Title must be 3-200 characters');
    }

    const updated = await this.prisma.repair.update({
      where: { id },
      data,
      include: REPAIR_INCLUDE,
    });

    await this.audit(this.prisma, tenantId, actor, 'repair.updated', id, dto);
    return updated;
  }

  async cancel(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    id: string,
  ) {
    this.requireManager(actor.userRole);

    const existing = await this.prisma.repair.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Repair not found');
    if (existing.status === 'DONE') throw new BadRequestException('Cannot cancel a completed repair');
    if (existing.status === 'CANCELLED') return existing;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.repair.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
        include: REPAIR_INCLUDE,
      });

      // Mark all active assignments as REASSIGNED (effectively retired)
      await tx.repairAssignment.updateMany({
        where: { repairId: id, status: { in: ['ASSIGNED', 'STARTED'] } },
        data: { status: 'REASSIGNED' },
      });

      // If this repair came from an incident, revert that incident back to OPEN
      // so the manager can decide what to do next (re-schedule, mark resolved manually, etc.)
      if (existing.incidentId) {
        await tx.incident.update({
          where: { id: existing.incidentId },
          data: { status: 'OPEN' },
        });
      }

      // Notify any active assignees
      const active = await tx.repairAssignment.findMany({
        where: { repairId: id, status: 'REASSIGNED' },
        select: { userId: true },
      });
      for (const a of active) {
        await this.notify(tx, tenantId, a.userId, 'CANCELLATION', 'Repair cancelled',
          `Repair "${existing.title}" was cancelled by the manager.`, { repairId: id });
      }

      await this.audit(tx, tenantId, actor, 'repair.cancelled', id, { title: existing.title });
      return updated;
    });
  }

  // ============================================================
  // ASSIGN / REASSIGN
  // ============================================================

  async assign(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    repairId: string,
    dto: AssignRepairDto,
  ) {
    this.requireManager(actor.userRole);

    if (!dto.userIds || dto.userIds.length === 0) {
      throw new BadRequestException('At least one assignee required');
    }

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId },
      include: { assignments: true },
    });
    if (!repair) throw new NotFoundException('Repair not found');
    if (repair.status === 'DONE') throw new BadRequestException('Cannot assign a completed repair');
    if (repair.status === 'CANCELLED') throw new BadRequestException('Cannot assign a cancelled repair');

    // Verify all userIds are REPAIRMAN role in this tenant
    const users = await this.prisma.user.findMany({
      where: { id: { in: dto.userIds }, tenantId, role: 'REPAIRMAN', isActive: true },
      select: { id: true, name: true },
    });
    if (users.length !== dto.userIds.length) {
      throw new BadRequestException('One or more users are not active repairmen in this tenant');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assignInTx(tx, repairId, dto.userIds, dto.primaryUserId, actor.userId);

      // Transition status if it was PLANNED
      const next = repair.status === 'PLANNED' ? 'ASSIGNED' : repair.status;
      const updated = await tx.repair.update({
        where: { id: repairId },
        data: { status: next },
        include: REPAIR_INCLUDE,
      });

      // Notify newly assigned repairmen
      for (const userId of dto.userIds) {
        await this.notify(tx, tenantId, userId, 'NEW_ASSIGNMENT',
          'New repair assigned',
          `You have been assigned to repair "${repair.title}".`,
          { repairId });
      }

      await this.audit(tx, tenantId, actor, 'repair.assigned', repairId, {
        userIds: dto.userIds, primaryUserId: dto.primaryUserId,
      });
      return updated;
    });
  }

  // Internal helper — assumes manager check already done
  private async assignInTx(
    tx: any,
    repairId: string,
    userIds: string[],
    primaryUserId: string | undefined,
    assignedById: string,
  ) {
    // Retire any current active assignments NOT in the new set
    await tx.repairAssignment.updateMany({
      where: {
        repairId,
        status: { in: ['ASSIGNED', 'STARTED'] },
        userId: { notIn: userIds },
      },
      data: { status: 'REASSIGNED' },
    });

    // For each new userId, create-or-reactivate
    for (const userId of userIds) {
      const isPrimary = primaryUserId
        ? userId === primaryUserId
        : userId === userIds[0]; // default first as primary

      const existing = await tx.repairAssignment.findFirst({
        where: { repairId, userId },
      });

      if (existing) {
        // Reactivate if previously REASSIGNED/REJECTED; preserve status if active
        if (existing.status === 'REASSIGNED' || existing.status === 'REJECTED') {
          await tx.repairAssignment.update({
            where: { id: existing.id },
            data: {
              status: 'ASSIGNED',
              isPrimary,
              rejectedReason: null,
              assignedAt: new Date(),
              assignedById,
            },
          });
        } else {
          // Just update primary flag if needed
          if (existing.isPrimary !== isPrimary) {
            await tx.repairAssignment.update({
              where: { id: existing.id },
              data: { isPrimary },
            });
          }
        }
      } else {
        await tx.repairAssignment.create({
          data: {
            repairId,
            userId,
            assignedById,
            isPrimary,
            status: 'ASSIGNED',
          },
        });
      }
    }
  }

  // ============================================================
  // REPAIRMAN ACTIONS: start / submitDone / reportProblem
  // ============================================================

  async start(
    actor: { userId: string; userRole: UserRole; tenantId: string },
    repairId: string,
  ) {
    if (actor.userRole !== 'REPAIRMAN' && actor.userRole !== 'MANAGER') {
      throw new ForbiddenException('Only repairmen can start repairs');
    }

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId: actor.tenantId },
      include: { assignments: true },
    });
    if (!repair) throw new NotFoundException('Repair not found');

    const myAssignment = repair.assignments.find(
      (a) => a.userId === actor.userId && (a.status === 'ASSIGNED' || a.status === 'STARTED'),
    );
    if (!myAssignment) throw new ForbiddenException('You are not assigned to this repair');

    if (repair.status === 'DONE' || repair.status === 'CANCELLED') {
      throw new BadRequestException('Repair is no longer active');
    }
    if (repair.status === 'IN_REVIEW') {
      throw new BadRequestException('Repair is already submitted for review');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Update assignment status if not already STARTED
      if (myAssignment.status === 'ASSIGNED') {
        await tx.repairAssignment.update({
          where: { id: myAssignment.id },
          data: { status: 'STARTED', startedAt: now },
        });
      }

      // Update repair status if it wasn't IN_PROGRESS yet
      const updateData: any = {};
      if (repair.status === 'ASSIGNED' || repair.status === 'REPORTED_BACK') {
        updateData.status = 'IN_PROGRESS';
      }
      if (!repair.startedAt) {
        updateData.startedAt = now;
      }

      const updated = Object.keys(updateData).length > 0
        ? await tx.repair.update({
            where: { id: repairId },
            data: updateData,
            include: REPAIR_INCLUDE,
          })
        : await tx.repair.findUnique({ where: { id: repairId }, include: REPAIR_INCLUDE });

      await this.audit(tx, actor.tenantId, actor, 'repair.started', repairId, {});
      return updated;
    });
  }

  async submitDone(
    actor: { userId: string; userRole: UserRole; tenantId: string },
    repairId: string,
    dto: SubmitDoneDto,
  ) {
    if (actor.userRole !== 'REPAIRMAN' && actor.userRole !== 'MANAGER') {
      throw new ForbiddenException('Only repairmen can submit work');
    }

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId: actor.tenantId },
      include: { assignments: true },
    });
    if (!repair) throw new NotFoundException('Repair not found');

    const myAssignment = repair.assignments.find(
      (a) => a.userId === actor.userId && (a.status === 'ASSIGNED' || a.status === 'STARTED'),
    );
    if (!myAssignment) throw new ForbiddenException('You are not assigned to this repair');

    if (repair.status === 'DONE' || repair.status === 'CANCELLED' || repair.status === 'IN_REVIEW') {
      throw new BadRequestException(`Cannot submit Done from status ${repair.status}`);
    }

    // Validate materials reference real catalog entries
    if (dto.materials && dto.materials.length > 0) {
      const materialIds = dto.materials.map((m) => m.materialId);
      const found = await this.prisma.repairMaterial.findMany({
        where: { id: { in: materialIds }, tenantId: actor.tenantId, isActive: true },
        select: { id: true },
      });
      if (found.length !== materialIds.length) {
        throw new BadRequestException('One or more materials are invalid or inactive');
      }
      for (const m of dto.materials) {
        if (!Number.isFinite(m.amount) || m.amount <= 0) {
          throw new BadRequestException('Material amount must be > 0');
        }
      }
    }

    if (dto.photoUrls && dto.photoUrls.length > 20) {
      throw new BadRequestException('Maximum 20 photos per submission');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Materials usage
      if (dto.materials && dto.materials.length > 0) {
        await tx.repairMaterialUsage.createMany({
          data: dto.materials.map((m) => ({
            repairId,
            materialId: m.materialId,
            amount: m.amount,
            note: m.note?.trim() || null,
          })),
        });
      }

      // Photos
      if (dto.photoUrls && dto.photoUrls.length > 0) {
        await tx.repairPhoto.createMany({
          data: dto.photoUrls.map((url) => ({
            repairId,
            url,
            uploadedById: actor.userId,
          })),
        });
      }

      // Optional comment
      if (dto.comment && dto.comment.trim()) {
        await tx.repairComment.create({
          data: {
            repairId,
            authorId: actor.userId,
            authorRole: actor.userRole === 'MANAGER' ? 'MANAGER' : 'REPAIRMAN',
            body: dto.comment.trim(),
          },
        });
      }

      // Mark assignment complete
      await tx.repairAssignment.update({
        where: { id: myAssignment.id },
        data: { status: 'COMPLETED', completedAt: now },
      });

      // Mark repair IN_REVIEW
      const updated = await tx.repair.update({
        where: { id: repairId },
        data: { status: 'IN_REVIEW', completedAt: now },
        include: REPAIR_INCLUDE,
      });

      // Notify managers
      const managers = await tx.user.findMany({
        where: { tenantId: actor.tenantId, role: 'MANAGER', isActive: true },
        select: { id: true },
      });
      for (const m of managers) {
        await this.notify(tx, actor.tenantId, m.id, 'REMINDER',
          'Repair ready for review',
          `Repair "${repair.title}" is ready for your review.`,
          { repairId });
      }

      await this.audit(tx, actor.tenantId, actor, 'repair.done_submitted', repairId, {
        materialsUsed: dto.materials?.length ?? 0,
        photosAttached: dto.photoUrls?.length ?? 0,
      });
      return updated;
    });
  }

  async reportProblem(
    actor: { userId: string; userRole: UserRole; tenantId: string },
    repairId: string,
    dto: ReportProblemDto,
  ) {
    if (actor.userRole !== 'REPAIRMAN' && actor.userRole !== 'MANAGER') {
      throw new ForbiddenException('Only repairmen can report problems');
    }

    if (!dto.description || dto.description.trim().length < 3) {
      throw new BadRequestException('Description is required');
    }
    if (dto.description.length > 1000) {
      throw new BadRequestException('Description too long (max 1000 chars)');
    }
    if (dto.photoUrls && dto.photoUrls.length > 20) {
      throw new BadRequestException('Maximum 20 photos per report');
    }
    if (!['LOW', 'AVERAGE', 'HIGH'].includes(dto.urgency)) {
      throw new BadRequestException('Invalid urgency');
    }

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId: actor.tenantId },
      include: { assignments: true },
    });
    if (!repair) throw new NotFoundException('Repair not found');

    const myAssignment = repair.assignments.find(
      (a) => a.userId === actor.userId && (a.status === 'ASSIGNED' || a.status === 'STARTED'),
    );
    if (!myAssignment) throw new ForbiddenException('You are not assigned to this repair');

    if (repair.status === 'DONE' || repair.status === 'CANCELLED') {
      throw new BadRequestException('Repair is no longer active');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Create report record
      await tx.repairReport.create({
        data: {
          repairId,
          authorId: actor.userId,
          urgency: dto.urgency,
          description: dto.description.trim(),
          photoUrls: dto.photoUrls ?? [],
        },
      });

      // Move repair to REPORTED_BACK
      const updated = await tx.repair.update({
        where: { id: repairId },
        data: { status: 'REPORTED_BACK', reportedAt: now },
        include: REPAIR_INCLUDE,
      });

      // Notify managers
      const managers = await tx.user.findMany({
        where: { tenantId: actor.tenantId, role: 'MANAGER', isActive: true },
        select: { id: true },
      });
      for (const m of managers) {
        await this.notify(tx, actor.tenantId, m.id, 'REMINDER',
          'Repair problem reported',
          `Repairman reported a ${dto.urgency.toLowerCase()} issue on "${repair.title}".`,
          { repairId, urgency: dto.urgency });
      }

      await this.audit(tx, actor.tenantId, actor, 'repair.problem_reported', repairId, {
        urgency: dto.urgency,
      });
      return updated;
    });
  }

  // ============================================================
  // MANAGER REVIEW: approve / rejectReview
  // ============================================================

  async approve(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    repairId: string,
  ) {
    this.requireManager(actor.userRole);

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId },
    });
    if (!repair) throw new NotFoundException('Repair not found');
    if (repair.status !== 'IN_REVIEW') {
      throw new BadRequestException(`Can only approve repairs in review (current: ${repair.status})`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.repair.update({
        where: { id: repairId },
        data: { status: 'DONE', reviewedAt: new Date() },
        include: REPAIR_INCLUDE,
      });

      // If this repair came from an incident, auto-resolve that incident
      if (repair.incidentId) {
        await tx.incident.update({
          where: { id: repair.incidentId },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedById: actor.userId,
            resolutionNote: `Resolved via repair: ${repair.title}`,
          },
        });
      }

      await this.audit(tx, tenantId, actor, 'repair.approved', repairId, {});

      // Notify primary repairman
      const primary = await tx.repairAssignment.findFirst({
        where: { repairId, isPrimary: true },
      });
      if (primary) {
        await this.notify(tx, tenantId, primary.userId, 'REMINDER',
          'Repair approved',
          `Your repair "${repair.title}" has been approved. Great work!`,
          { repairId });
      }

      return updated;
    });
  }

  async rejectReview(
    tenantId: string,
    actor: { userId: string; userRole: UserRole },
    repairId: string,
    note?: string,
  ) {
    this.requireManager(actor.userRole);

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId },
      include: { assignments: true },
    });
    if (!repair) throw new NotFoundException('Repair not found');
    if (repair.status !== 'IN_REVIEW') {
      throw new BadRequestException('Can only reject a repair in review');
    }

    return this.prisma.$transaction(async (tx) => {
      // Add a comment with the rejection note
      if (note && note.trim()) {
        await tx.repairComment.create({
          data: {
            repairId,
            authorId: actor.userId,
            authorRole: 'MANAGER',
            body: `Review rejected: ${note.trim()}`,
          },
        });
      }

      // Reactivate primary assignee so they can continue
      const primary = repair.assignments.find((a) => a.isPrimary);
      if (primary) {
        await tx.repairAssignment.update({
          where: { id: primary.id },
          data: { status: 'STARTED', completedAt: null },
        });
        await this.notify(tx, tenantId, primary.userId, 'REMINDER',
          'Repair review rejected',
          note?.trim()
            ? `Manager rejected the review: ${note.trim()}`
            : 'Manager rejected the review. Please check and resubmit.',
          { repairId });
      }

      const updated = await tx.repair.update({
        where: { id: repairId },
        data: { status: 'IN_PROGRESS', completedAt: null },
        include: REPAIR_INCLUDE,
      });

      await this.audit(tx, tenantId, actor, 'repair.review_rejected', repairId, { note });
      return updated;
    });
  }

  // ============================================================
  // COMMENTS
  // ============================================================

  async addComment(
    actor: { userId: string; userRole: UserRole; tenantId: string },
    repairId: string,
    body: string,
  ) {
    if (!body || body.trim().length === 0) {
      throw new BadRequestException('Comment cannot be empty');
    }
    if (body.length > 2000) {
      throw new BadRequestException('Comment too long (max 2000 chars)');
    }

    const repair = await this.prisma.repair.findFirst({
      where: { id: repairId, tenantId: actor.tenantId },
      include: { assignments: true },
    });
    if (!repair) throw new NotFoundException('Repair not found');

    // Repairmen can only comment if assigned
    if (actor.userRole === 'REPAIRMAN') {
      const isAssigned = repair.assignments.some((a) => a.userId === actor.userId);
      if (!isAssigned) throw new ForbiddenException('You are not assigned to this repair');
    }

    const authorRole: RepairAuthorRole =
      actor.userRole === 'MANAGER' ? 'MANAGER' : 'REPAIRMAN';

    const comment = await this.prisma.repairComment.create({
      data: {
        repairId,
        authorId: actor.userId,
        authorRole,
        body: body.trim(),
      },
      include: { author: { select: { id: true, name: true } } },
    });

    // Notify the other party
    if (actor.userRole === 'REPAIRMAN') {
      const managers = await this.prisma.user.findMany({
        where: { tenantId: actor.tenantId, role: 'MANAGER', isActive: true },
        select: { id: true },
      });
      for (const m of managers) {
        await this.notify(this.prisma, actor.tenantId, m.id, 'REMINDER',
          'New repair comment',
          `Repairman commented on "${repair.title}".`,
          { repairId });
      }
    } else {
      // Manager → notify all active assignees
      const assignees = repair.assignments
        .filter((a) => a.status === 'ASSIGNED' || a.status === 'STARTED')
        .map((a) => a.userId);
      for (const uid of assignees) {
        await this.notify(this.prisma, actor.tenantId, uid, 'REMINDER',
          'New repair comment',
          `Manager commented on "${repair.title}".`,
          { repairId });
      }
    }

    return comment;
  }

  async listComments(tenantId: string, repairId: string) {
    const repair = await this.prisma.repair.findFirst({ where: { id: repairId, tenantId } });
    if (!repair) throw new NotFoundException('Repair not found');

    return this.prisma.repairComment.findMany({
      where: { repairId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private requireManager(role: UserRole) {
    if (role !== 'MANAGER') {
      throw new ForbiddenException('Manager role required');
    }
  }

  private validateRepairBasics(
    title: string | undefined,
    description: string | null | undefined,
    dueDate: string | undefined,
    propertyId: string | undefined,
  ) {
    if (!title || title.trim().length < 3 || title.trim().length > 200) {
      throw new BadRequestException('Title must be 3-200 characters');
    }
    if (description && description.length > 1000) {
      throw new BadRequestException('Description too long (max 1000 chars)');
    }
    if (!propertyId) throw new BadRequestException('Property is required');
    if (!dueDate) throw new BadRequestException('Due date is required');
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Invalid due date');
    }
  }

  private async notify(
    db: any,
    tenantId: string,
    userId: string,
    type: 'NEW_ASSIGNMENT' | 'REASSIGNMENT' | 'CANCELLATION' | 'REMINDER',
    title: string,
    body: string,
    payload: Record<string, any>,
  ) {
    try {
      await db.notification.create({
        data: {
          tenantId,
          userId,
          type,
          channel: 'IN_APP',
          title,
          body,
          payload,
        },
      });
    } catch (e) {
      // Don't block on notification failure
      this.logger.warn(`Failed to create notification: ${(e as Error).message}`);
    }
  }

  private async audit(
    db: any,
    tenantId: string,
    actor: { userId: string },
    action: string,
    targetId: string,
    metadata: Record<string, any>,
  ) {
    try {
      await db.auditEvent.create({
        data: {
          tenantId,
          category: 'SYSTEM', // no REPAIR_LIFECYCLE category yet; bucket under SYSTEM
          action,
          actorId: actor.userId,
          targetType: 'Repair',
          targetId,
          metadata: metadata as any,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to write audit event: ${(e as Error).message}`);
    }
  }
}