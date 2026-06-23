import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  TurnoverStatus,
  AssignmentStatus,
  AuditCategory,
  IncidentPriority,
  Prisma,
} from '@prisma/client';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { IncidentsService } from '../incidents/incidents.service';

interface UpdateTurnoverDto {
  managerNote?: string;
  supplyNote?: string;
  maxCleaners?: number;
}

interface MarkDoneDto {
  allGood: boolean;
  note?: string;
  photoUrls?: string[];   // accepted but not persisted (no TurnoverPhoto model yet)
  priority?: IncidentPriority;
}

/** Assignment statuses that count as "actively holding a slot on the turnover". */
const ACTIVE_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.STARTED,
];

/** Minimum hours before dueBy during which drop is allowed. */
const DROP_CUTOFF_HOURS = 12;

/**
 * Rolling window for the cleaner pool, in days.
 *
 * The pool only shows turnovers whose `availableFrom` (the moment the cleaning
 * slot opens, i.e. the prior guest's check-out time) is on or after
 * `now - POOL_STALE_CUTOFF_DAYS`. Anything older is considered stale and is
 * assumed to have been resolved out-of-band; it stays in the database for audit
 * but is hidden from the cleaner's pool.
 *
 * This filter also implicitly excludes "orphan" rows where `availableFrom IS
 * NULL`. In practice every NULL-availableFrom row in this codebase also has
 * NULL `fromBookingId`, so those leading-null rows are excluded too — they are
 * almost always artifacts of the historical re-projection, not real first-ever
 * bookings.
 *
 * Owner stays (`isOwnerStay = true`) are NOT excluded — they still need
 * cleaning and remain in the pool.
 */
const POOL_STALE_CUTOFF_DAYS = 2;

// Full include for turnover detail queries
const TURNOVER_INCLUDE = {
  property: {
    select: {
      id: true,
      name: true,
      address: true,
      locationLat: true,
      locationLng: true,
    },
  },
  fromBooking: {
    select: {
      id: true,
      bookingRef: true,
      pmsBookingId: true,
      status: true,
      cancelledAt: true,
      checkInTime: true,
      checkOutTime: true,
      isOwnerStay: true,
      accommodationName: true,
      numAdults: true,
      numChildren: true,
      channel: true,
    },
  },
  toBooking: {
    select: {
      id: true,
      bookingRef: true,
      pmsBookingId: true,
      status: true,
      cancelledAt: true,
      checkInTime: true,
      checkOutTime: true,
      isOwnerStay: true,
      accommodationName: true,
      numAdults: true,
      numChildren: true,
      channel: true,
    },
  },
  assignments: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignedBy: { select: { id: true, name: true } },
    },
    orderBy: { assignedAt: 'asc' as const },
  },
};

@Injectable()
export class TurnoversService {
  private readonly logger = new Logger(TurnoversService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
    private incidents: IncidentsService,
  ) {}

  // ─── QUERIES ───────────────────────────────────────────────

  /**
   * Returns turnovers whose [availableFrom, dueBy] window overlaps the date.
   * For a cleaner, filters to their assigned ones.
   */
  async findByDate(tenantId: string, date: string, userId?: string) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const where: any = {
      tenantId,
      supersededById: null,
      status: { notIn: [TurnoverStatus.CANCELLED, TurnoverStatus.SKIPPED] },
      // Window-overlap: availableFrom <= endOfDay AND (dueBy >= startOfDay OR dueBy is null)
      AND: [
        {
          OR: [
            { availableFrom: { lte: endOfDay } },
            { availableFrom: null },
          ],
        },
        {
          OR: [
            { dueBy: { gte: startOfDay } },
            { dueBy: null },
          ],
        },
      ],
    };

    if (userId) {
      where.assignments = {
        some: {
          userId,
          status: { not: AssignmentStatus.REASSIGNED },
        },
      };
    }

    return this.prisma.turnover.findMany({
      where,
      include: TURNOVER_INCLUDE,
      orderBy: [
        { dueBy: { sort: 'asc', nulls: 'last' } },
        { availableFrom: 'asc' },
      ],
    });
  }

  async findByDateRange(tenantId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    return this.prisma.turnover.findMany({
      where: {
        tenantId,
        supersededById: null,
        status: { notIn: [TurnoverStatus.CANCELLED, TurnoverStatus.SKIPPED] },
        AND: [
          {
            OR: [
              { availableFrom: { lte: toDate } },
              { availableFrom: null },
            ],
          },
          {
            OR: [
              { dueBy: { gte: fromDate } },
              { dueBy: null },
            ],
          },
        ],
      },
      include: TURNOVER_INCLUDE,
      orderBy: [
        { dueBy: { sort: 'asc', nulls: 'last' } },
        { availableFrom: 'asc' },
      ],
    });
  }

  async findById(tenantId: string, turnoverId: string) {
    const turnover = await this.prisma.turnover.findFirst({
      where: { id: turnoverId, tenantId },
      include: TURNOVER_INCLUDE,
    });
    if (!turnover) throw new NotFoundException('Turnover not found');
    return turnover;
  }

  /**
   * POOL — turnovers in PENDING status that a cleaner can claim.
   *
   * Filtered by a rolling `availableFrom >= now - POOL_STALE_CUTOFF_DAYS`
   * window (see the constant at the top of this file). This narrows the pool
   * from "every PENDING row that ever existed" to "turnovers whose cleaning
   * slot is current or recently opened", which is what cleaners actually need
   * to see.
   *
   * Frontend then groups by COALESCE(availableFrom, dueBy) with carry-forward
   * to today, so items with availableFrom in the last few days surface under
   * today's header.
   *
   * If userId given (CLEANER role), additionally filters by their property
   * preferences. No selection → empty list (forces cleaner to pick in Settings
   * first).
   */
  async getPool(tenantId: string, userId?: string) {
    // Rolling cutoff: midnight, N days ago, in server local time.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - POOL_STALE_CUTOFF_DAYS);
    cutoff.setHours(0, 0, 0, 0);

    const where: any = {
      tenantId,
      status: TurnoverStatus.PENDING,
      supersededById: null,
      // Implicitly drops orphan rows (availableFrom IS NULL) — { gte } excludes nulls.
      availableFrom: { gte: cutoff },
    };

    if (userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { preferences: true },
      });
      const prefs = (user?.preferences as any) ?? {};
      const propertyIds: string[] = prefs?.cleaningsPoolFilter?.propertyIds ?? [];

      if (!propertyIds.length) return [];
      where.propertyId = { in: propertyIds };
    }

    return this.prisma.turnover.findMany({
      where,
      include: TURNOVER_INCLUDE,
      orderBy: [
        { dueBy: { sort: 'asc', nulls: 'last' } },
        { availableFrom: 'asc' },
      ],
    });
  }

  /**
   * MINE — turnovers where the given user has an active or completed assignment.
   */
  async getMine(
    tenantId: string,
    userId: string,
    opts: { from?: string; to?: string; propertyIds?: string[] } = {},
  ) {
    const where: any = {
      tenantId,
      supersededById: null,
      assignments: {
        some: {
          userId,
          status: { not: AssignmentStatus.REASSIGNED },
        },
      },
    };

    if (opts.from || opts.to) {
      const fromDate = opts.from ? new Date(opts.from) : null;
      const toDate = opts.to ? new Date(opts.to) : null;
      const andClauses: any[] = [];
      if (toDate) {
        andClauses.push({
          OR: [{ availableFrom: { lte: toDate } }, { availableFrom: null }],
        });
      }
      if (fromDate) {
        andClauses.push({
          OR: [{ dueBy: { gte: fromDate } }, { dueBy: null }],
        });
      }
      where.AND = andClauses;
    }

    if (opts.propertyIds?.length) {
      where.propertyId = { in: opts.propertyIds };
    }

    return this.prisma.turnover.findMany({
      where,
      include: TURNOVER_INCLUDE,
      orderBy: [
        { dueBy: { sort: 'asc', nulls: 'last' } },
        { availableFrom: 'asc' },
      ],
    });
  }

  /**
   * Per-cleaner dashboard stats for the pool header:
   *  - cdmUserId       — the cleaner's GCP staff id (display only)
   *  - doneThisMonth   — assignments this cleaner completed in the current
   *                      Prague calendar month
   *  - assignedNotDone — assignments still actively held (ASSIGNED or STARTED)
   */
  async getMyStats(tenantId: string, userId: string) {
    const { start, end } = pragueMonthRange(new Date());

    const [doneThisMonth, assignedNotDone, me] = await Promise.all([
      this.prisma.turnoverAssignment.count({
        where: {
          userId,
          status: AssignmentStatus.COMPLETED,
          completedAt: { gte: start, lt: end },
          turnover: { tenantId },
        },
      }),
      this.prisma.turnoverAssignment.count({
        where: {
          userId,
          status: { in: ACTIVE_STATUSES },
          turnover: { tenantId, supersededById: null },
        },
      }),
      this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { cdmUserId: true },
      }),
    ]);

    return {
      cdmUserId: me?.cdmUserId ?? null,
      doneThisMonth,
      assignedNotDone,
    };
  }

  // ─── MUTATIONS ─────────────────────────────────────────────

  async update(tenantId: string, turnoverId: string, dto: UpdateTurnoverDto) {
    const existing = await this.findById(tenantId, turnoverId);

    if (dto.maxCleaners !== undefined) {
      if (dto.maxCleaners < 1) {
        throw new BadRequestException('maxCleaners must be at least 1');
      }
      const activeCount = existing.assignments.filter((a) =>
        ACTIVE_STATUSES.includes(a.status),
      ).length;
      if (dto.maxCleaners < activeCount) {
        throw new BadRequestException(
          `Cannot set maxCleaners below current active assignment count (${activeCount})`,
        );
      }
    }

    const updated = await this.prisma.turnover.update({
      where: { id: turnoverId },
      data: {
        ...(dto.managerNote !== undefined && { managerNote: dto.managerNote }),
        ...(dto.supplyNote !== undefined && { supplyNote: dto.supplyNote }),
        ...(dto.maxCleaners !== undefined && { maxCleaners: dto.maxCleaners }),
      },
      include: TURNOVER_INCLUDE,
    });

    this.gateway.notifyEventUpdated(tenantId, updated as any);
    return updated;
  }

  async cancel(tenantId: string, turnoverId: string) {
    const turnover = await this.findById(tenantId, turnoverId);
    if (turnover.status === TurnoverStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed turnover');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.turnover.update({
        where: { id: turnoverId },
        data: {
          status: TurnoverStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        include: TURNOVER_INCLUDE,
      });

      await tx.turnoverAssignment.updateMany({
        where: {
          turnoverId,
          status: { in: ACTIVE_STATUSES },
        },
        data: { status: AssignmentStatus.REASSIGNED },
      });

      return t;
    });

    this.gateway.notifyEventCancelled(tenantId, updated as any);
    return updated;
  }

  // ─── POOL LIFECYCLE ─────────────────────────────────────────

  /**
   * Cleaner claims a turnover from the pool.
   * Atomic via Serializable isolation — concurrent claimers can't both win.
   */
  async claim(tenantId: string, userId: string, turnoverId: string) {
    let result;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const turnover = await tx.turnover.findFirst({
            where: { id: turnoverId, tenantId },
            include: {
              assignments: {
                where: { status: { in: ACTIVE_STATUSES } },
              },
              toBooking: { select: { bookingRef: true, accommodationName: true } },
              fromBooking: { select: { bookingRef: true, accommodationName: true } },
            },
          });

          if (!turnover) {
            throw new NotFoundException('Turnover not found');
          }
          if (turnover.status !== TurnoverStatus.PENDING) {
            throw new BadRequestException('Turnover is not in the pool');
          }

          const alreadyMine = turnover.assignments.find((a) => a.userId === userId);
          if (alreadyMine) {
            throw new BadRequestException('You already claimed this turnover');
          }

          const activeCount = turnover.assignments.length;
          if (activeCount >= turnover.maxCleaners) {
            throw new BadRequestException('Turnover is already full');
          }

          const isPrimary = activeCount === 0;
          const newCount = activeCount + 1;

          const assignment = await tx.turnoverAssignment.create({
            data: {
              turnoverId,
              userId,
              isPrimary,
              status: AssignmentStatus.ASSIGNED,
            },
          });

          if (newCount >= turnover.maxCleaners) {
            await tx.turnover.update({
              where: { id: turnoverId },
              data: { status: TurnoverStatus.ASSIGNED },
            });
          }

          const bookingRef =
            turnover.toBooking?.bookingRef ?? turnover.fromBooking?.bookingRef ?? null;
          const accommodationName =
            turnover.toBooking?.accommodationName ??
            turnover.fromBooking?.accommodationName ??
            null;

          await tx.auditEvent.create({
            data: {
              tenantId,
              category: AuditCategory.CLEANING_LIFECYCLE,
              action: 'turnover.claimed',
              actorId: userId,
              targetType: 'Turnover',
              targetId: turnoverId,
              metadata: {
                accommodationName,
                bookingRef,
                isPrimary,
                filledEvent: newCount >= turnover.maxCleaners,
              } as any,
            },
          });

          return { assignment, filled: newCount >= turnover.maxCleaners };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err: any) {
      if (err?.code === 'P2034') {
        throw new BadRequestException(
          'Another cleaner claimed it first — please try another',
        );
      }
      throw err;
    }

    const fresh = await this.findById(tenantId, turnoverId);
    this.gateway.notifyEventUpdated(tenantId, fresh as any);
    return { turnover: fresh, assignment: result.assignment };
  }

  /**
   * Cleaner drops a turnover they previously claimed.
   * Blocked within DROP_CUTOFF_HOURS of dueBy (if dueBy is set).
   */
  async drop(tenantId: string, userId: string, turnoverId: string) {
    const fresh = await this.prisma.$transaction(async (tx) => {
      const turnover = await tx.turnover.findFirst({
        where: { id: turnoverId, tenantId },
        include: {
          assignments: {
            where: { status: { in: ACTIVE_STATUSES } },
          },
          toBooking: { select: { bookingRef: true, accommodationName: true } },
          fromBooking: { select: { bookingRef: true, accommodationName: true } },
        },
      });

      if (!turnover) throw new NotFoundException('Turnover not found');

      // Only enforce cutoff if dueBy is set (trailing nulls have no deadline)
      if (turnover.dueBy) {
        const hoursUntil =
          (turnover.dueBy.getTime() - Date.now()) / (1000 * 60 * 60);
        if (hoursUntil < DROP_CUTOFF_HOURS) {
          throw new BadRequestException(
            `Cannot drop within ${DROP_CUTOFF_HOURS} hours of the scheduled time`,
          );
        }
      }

      const mine = turnover.assignments.find((a) => a.userId === userId);
      if (!mine) {
        throw new BadRequestException('You are not assigned to this turnover');
      }

      await tx.turnoverAssignment.update({
        where: { id: mine.id },
        data: { status: AssignmentStatus.REASSIGNED },
      });

      const remaining = turnover.assignments.filter((a) => a.id !== mine.id);

      if (mine.isPrimary && remaining.length > 0) {
        const [nextPrimary] = remaining;
        await tx.turnoverAssignment.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }

      await tx.turnover.update({
        where: { id: turnoverId },
        data: { status: TurnoverStatus.PENDING },
      });

      const bookingRef =
        turnover.toBooking?.bookingRef ?? turnover.fromBooking?.bookingRef ?? null;
      const accommodationName =
        turnover.toBooking?.accommodationName ??
        turnover.fromBooking?.accommodationName ??
        null;

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.CLEANING_LIFECYCLE,
          action: 'turnover.dropped',
          actorId: userId,
          targetType: 'Turnover',
          targetId: turnoverId,
          metadata: {
            accommodationName,
            bookingRef,
            wasPrimary: mine.isPrimary,
            remainingCount: remaining.length,
          } as any,
        },
      });

      return tx.turnover.findFirst({
        where: { id: turnoverId },
        include: TURNOVER_INCLUDE,
      });
    });

    if (fresh) {
      this.gateway.notifyEventUpdated(tenantId, fresh as any);
    }
    return { dropped: true, turnover: fresh };
  }

  /**
   * Cleaner explicitly marks the cleaning as started. Logs `startedAt` on the
   * assignment (always) and on the turnover (only the first time any cleaner
   * starts — subsequent starts by co-cleaners don't overwrite the turnover-
   * level timestamp). Idempotent: calling start twice is a no-op the second
   * time.
   */
  async start(tenantId: string, userId: string, turnoverId: string) {
    await this.prisma.$transaction(async (tx) => {
      const turnover = await tx.turnover.findFirst({
        where: { id: turnoverId, tenantId },
        include: {
          assignments: true,
          toBooking: { select: { bookingRef: true, accommodationName: true } },
          fromBooking: { select: { bookingRef: true, accommodationName: true } },
        },
      });

      if (!turnover) throw new NotFoundException('Turnover not found');
      if (turnover.status === TurnoverStatus.COMPLETED) {
        throw new BadRequestException('Turnover is already completed');
      }
      if (turnover.status === TurnoverStatus.CANCELLED) {
        throw new BadRequestException('Turnover has been cancelled');
      }

      const mine = turnover.assignments.find(
        (a) => a.userId === userId && ACTIVE_STATUSES.includes(a.status),
      );
      if (!mine) {
        throw new BadRequestException(
          'You are not actively assigned to this turnover',
        );
      }

      const now = new Date();
      const firstStarter = !turnover.startedAt;

      // Assignment: flip to STARTED + stamp startedAt the first time only.
      if (mine.status !== AssignmentStatus.STARTED) {
        await tx.turnoverAssignment.update({
          where: { id: mine.id },
          data: {
            status: AssignmentStatus.STARTED,
            startedAt: mine.startedAt ?? now,
          },
        });
      }

      // Turnover: stamp startedAt + IN_PROGRESS only on first cleaner to start.
      if (firstStarter) {
        await tx.turnover.update({
          where: { id: turnoverId },
          data: {
            startedAt: now,
            status: TurnoverStatus.IN_PROGRESS,
          },
        });
      }

      const bookingRef =
        turnover.toBooking?.bookingRef ?? turnover.fromBooking?.bookingRef ?? null;
      const accommodationName =
        turnover.toBooking?.accommodationName ??
        turnover.fromBooking?.accommodationName ??
        null;

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.CLEANING_LIFECYCLE,
          action: 'turnover.started',
          actorId: userId,
          targetType: 'Turnover',
          targetId: turnoverId,
          metadata: {
            accommodationName,
            bookingRef,
            firstStarter,
          } as any,
        },
      });
    });

    const fresh = await this.findById(tenantId, turnoverId);
    this.gateway.notifyEventUpdated(tenantId, fresh as any);
    return { turnover: fresh };
  }

  /**
   * Cleaner marks their work on a turnover as done.
   * - allGood: true → just completes the assignment
   * - allGood: false → requires priority; on event-level completion, creates
   *   an Incident via incidentsService (still attached to the legacy Cleaning
   *   record for now — found via toBookingId).
   *
   * NOTE: photoUrls are accepted by the API but not persisted in Phase 3.2
   * (no TurnoverPhoto model yet). TODO: add photo storage.
   */
  async markDone(
    tenantId: string,
    userId: string,
    turnoverId: string,
    dto: MarkDoneDto,
  ) {
    if (!dto.allGood && !dto.priority) {
      throw new BadRequestException(
        'priority is required when reporting an issue',
      );
    }

    const actorUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true },
    });

    const { freshTurnover, needsIncident, matchingCleaningId } =
      await this.prisma.$transaction(async (tx) => {
        const turnover = await tx.turnover.findFirst({
          where: { id: turnoverId, tenantId },
          include: {
            assignments: true,
            toBooking: { select: { bookingRef: true, accommodationName: true, id: true } },
            fromBooking: { select: { bookingRef: true, accommodationName: true } },
          },
        });

        if (!turnover) throw new NotFoundException('Turnover not found');

        const mine = turnover.assignments.find(
          (a) => a.userId === userId && ACTIVE_STATUSES.includes(a.status),
        );
        if (!mine) {
          throw new BadRequestException(
            'You are not actively assigned to this turnover',
          );
        }

        const now = new Date();

        await tx.turnoverAssignment.update({
          where: { id: mine.id },
          data: {
            status: AssignmentStatus.COMPLETED,
            completedAt: now,
          },
        });

        if (!dto.allGood && dto.note) {
          await tx.turnover.update({
            where: { id: turnoverId },
            data: { cleanerNote: dto.note },
          });
        }
        // photoUrls intentionally NOT persisted — no TurnoverPhoto model yet (TODO)

        const stillActive = turnover.assignments.filter(
          (a) => a.id !== mine.id && ACTIVE_STATUSES.includes(a.status),
        );

        if (stillActive.length === 0) {
          await tx.turnover.update({
            where: { id: turnoverId },
            data: {
              status: TurnoverStatus.COMPLETED,
              completedAt: now,
              completedAllGood: dto.allGood,
            },
          });
        }

        const bookingRef =
          turnover.toBooking?.bookingRef ?? turnover.fromBooking?.bookingRef ?? null;
        const accommodationName =
          turnover.toBooking?.accommodationName ??
          turnover.fromBooking?.accommodationName ??
          null;

        await tx.auditEvent.create({
          data: {
            tenantId,
            category: AuditCategory.CLEANING_LIFECYCLE,
            action: dto.allGood ? 'turnover.done' : 'turnover.done_with_issue',
            actorId: userId,
            actorEmail: actorUser?.email ?? null,
            targetType: 'Turnover',
            targetId: turnoverId,
            metadata: {
              accommodationName,
              bookingRef,
              allGood: dto.allGood,
              hasNote: !!dto.note,
              photoCount: dto.photoUrls?.length ?? 0,
              eventCompleted: stillActive.length === 0,
              priority: dto.priority ?? null,
            } as any,
          },
        });

        // Find the matching cleaning by toBookingId for incident creation
        let matchingCleaningId: string | null = null;
        if (!dto.allGood && dto.priority && turnover.toBooking?.id) {
          const cleaning = await tx.cleaning.findFirst({
            where: { tenantId, bookingId: turnover.toBooking.id },
            select: { id: true },
          });
          matchingCleaningId = cleaning?.id ?? null;
        }

        const fresh = await tx.turnover.findFirst({
          where: { id: turnoverId },
          include: TURNOVER_INCLUDE,
        });

        return {
          freshTurnover: fresh,
          needsIncident: !dto.allGood,
          matchingCleaningId,
        };
      });

    if (freshTurnover) {
      this.gateway.notifyEventUpdated(tenantId, freshTurnover as any);
    }

    // Auto-create incident OUTSIDE the main transaction
    let incidentId: string | null = null;
    if (!dto.allGood && dto.priority) {
      if (matchingCleaningId) {
        const incident = await this.incidents.createFromCleaningDone(
          tenantId,
          {
            userId,
            userRole: actorUser?.role ?? 'CLEANER',
            userEmail: actorUser?.email,
          },
          {
            cleaningId: matchingCleaningId,
            priority: dto.priority,
            note: dto.note,
            photoUrls: dto.photoUrls,
          },
        );
        incidentId = incident.id;
      } else {
        this.logger.warn(
          `markDone(turnover=${turnoverId}) reported issue but no matching ` +
          `cleaning found via toBookingId — incident NOT created`,
        );
      }
    }

    return {
      done: true,
      needsIncident,
      incidentId,
      turnover: freshTurnover,
    };
  }

  /**
   * Manager releases an assigned turnover back to the pool.
   * All current assignments are dropped, status → PENDING, cleaners notified.
   */
  async releaseToPool(tenantId: string, managerId: string, turnoverId: string) {
    const { fresh, affected } = await this.prisma.$transaction(async (tx) => {
      const turnover = await tx.turnover.findFirst({
        where: { id: turnoverId, tenantId },
        include: {
          assignments: {
            where: { status: { in: ACTIVE_STATUSES } },
          },
          toBooking: { select: { bookingRef: true, accommodationName: true } },
          fromBooking: { select: { bookingRef: true, accommodationName: true } },
        },
      });

      if (!turnover) throw new NotFoundException('Turnover not found');
      if (turnover.status === TurnoverStatus.COMPLETED) {
        throw new BadRequestException('Cannot release a completed turnover');
      }
      if (turnover.status === TurnoverStatus.CANCELLED) {
        throw new BadRequestException('Cannot release a cancelled turnover');
      }

      const affectedUserIds = turnover.assignments.map((a) => a.userId);
      const bookingRef =
        turnover.toBooking?.bookingRef ?? turnover.fromBooking?.bookingRef ?? null;
      const accommodationName =
        turnover.toBooking?.accommodationName ??
        turnover.fromBooking?.accommodationName ??
        null;

      await tx.turnoverAssignment.updateMany({
        where: {
          turnoverId,
          status: { in: ACTIVE_STATUSES },
        },
        data: { status: AssignmentStatus.REASSIGNED },
      });

      await tx.turnover.update({
        where: { id: turnoverId },
        data: { status: TurnoverStatus.PENDING },
      });

      for (const uid of affectedUserIds) {
        await tx.notification.create({
          data: {
            tenantId,
            userId: uid,
            type: 'REASSIGNMENT' as any,
            channel: 'IN_APP',
            title: 'Turnover returned to pool',
            body: `A manager returned ${accommodationName ?? 'a turnover'} to the pool.`,
            payload: { turnoverId },
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.CLEANING_LIFECYCLE,
          action: 'turnover.released_to_pool',
          actorId: managerId,
          targetType: 'Turnover',
          targetId: turnoverId,
          metadata: {
            accommodationName,
            bookingRef,
            affectedUserIds,
          } as any,
        },
      });

      const updatedFresh = await tx.turnover.findFirst({
        where: { id: turnoverId },
        include: TURNOVER_INCLUDE,
      });

      return { fresh: updatedFresh, affected: affectedUserIds };
    });

    if (fresh) {
      this.gateway.notifyEventUpdated(tenantId, fresh as any);
      for (const uid of affected) {
        this.gateway.emitToUser(uid, 'assignment:released', { turnoverId });
      }
    }

    return { released: true, affectedUserIds: affected, turnover: fresh };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * First instant of the current month and first instant of next month, anchored
 * to Europe/Prague wall-clock time (DST-safe). Used to scope "this month"
 * counters so the window ticks over at Prague midnight, not UTC midnight.
 */
function pragueMonthRange(now: Date): { start: Date; end: Date } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: 'numeric',
  });
  const parts = f.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const start = pragueMidnightUtc(y, m, 1);
  const end = pragueMidnightUtc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
  return { start, end };
}

/** The UTC instant corresponding to 00:00 Europe/Prague on the given Y/M/D. */
function pragueMidnightUtc(year: number, month1to12: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month1to12 - 1, day, 0, 0, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = asUTC - guess.getTime();
  return new Date(guess.getTime() - offset);
}