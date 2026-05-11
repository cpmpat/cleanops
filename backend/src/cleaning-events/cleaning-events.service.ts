import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  CleaningEventStatus,
  CleaningType,
  BookingChannel,
  AssignmentStatus,
  AuditCategory,
  IncidentPriority,
  Prisma,
} from '@prisma/client';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { IncidentsService } from '../incidents/incidents.service';

interface CreateEventDto {
  propertyId: string;
  bookingRef: string;
  pmsBookingId?: string;
  checkInTime: string;
  checkOutTime?: string;
  accommodationName: string;
  numAdults?: number;
  numChildren?: number;
  channel?: BookingChannel;
  cleaningType?: CleaningType;
  timeSlot: string;
  managerNote?: string;
  maxCleaners?: number;
}

interface UpdateEventDto {
  checkInTime?: string;
  timeSlot?: string;
  cleaningType?: CleaningType;
  managerNote?: string;
  supplyNote?: string;
  maxCleaners?: number;
}

interface MarkDoneDto {
  allGood: boolean;
  note?: string;
  photoUrls?: string[];
  priority?: IncidentPriority;
}

/** Assignment statuses that count as "actively holding a slot on the event". */
const ACTIVE_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.STARTED,
];

/** Minimum hours before timeSlot during which drop is allowed. */
const DROP_CUTOFF_HOURS = 12;

// Full include for event detail queries
const EVENT_INCLUDE = {
  property: {
    select: {
      id: true,
      name: true,
      address: true,
      locationLat: true,
      locationLng: true,
    },
  },
  assignments: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignedBy: { select: { id: true, name: true } },
      photos: true,
    },
    orderBy: { assignedAt: 'asc' as const },
  },
  eventTags: { include: { tag: true } },
  photos: true,
};

@Injectable()
export class CleaningEventsService {
  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
    private incidents: IncidentsService,
  ) {}

  // ─── QUERIES ───────────────────────────────────────────────

  async findByDate(tenantId: string, date: string, userId?: string) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const where: any = {
      tenantId,
      timeSlot: { gte: startOfDay, lte: endOfDay },
      status: { not: CleaningEventStatus.CANCELLED },
    };

    if (userId) {
      where.assignments = {
        some: {
          userId,
          status: { not: AssignmentStatus.REASSIGNED },
        },
      };
    }

    return this.prisma.cleaningEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: { timeSlot: 'asc' },
    });
  }

  async findByDateRange(tenantId: string, from: string, to: string) {
    return this.prisma.cleaningEvent.findMany({
      where: {
        tenantId,
        timeSlot: { gte: new Date(from), lte: new Date(to) },
      },
      include: EVENT_INCLUDE,
      orderBy: { timeSlot: 'asc' },
    });
  }

  async findById(tenantId: string, eventId: string) {
    const event = await this.prisma.cleaningEvent.findFirst({
      where: { id: eventId, tenantId },
      include: EVENT_INCLUDE,
    });
    if (!event) throw new NotFoundException('Cleaning event not found');
    return event;
  }

  /**
   * POOL — events in PENDING status that a cleaner can claim.
   * Only shows future events (timeSlot >= now).
   *
   * If userId is given (cleaner role), filters to the user's selected properties.
   * If user has no selections yet, returns an empty array (forces them to pick first).
   */
  async getPool(tenantId: string, userId?: string) {
    const now = new Date();
    const where: any = {
      tenantId,
      status: CleaningEventStatus.PENDING,
      timeSlot: { gte: now },
    };

    if (userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { preferences: true },
      });
      const prefs = (user?.preferences as any) ?? {};
      const propertyIds: string[] = prefs?.cleaningsPoolFilter?.propertyIds ?? [];

      // No selection yet → empty list (cleaner must pick in Settings first)
      if (!propertyIds.length) return [];
      where.propertyId = { in: propertyIds };
    }

    return this.prisma.cleaningEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: [{ timeSlot: 'asc' }, { accommodationName: 'asc' }],
    });
  }

  /**
   * MINE — events where the given user has an active or completed assignment.
   * Supports date-range filter for This Week / Next Month views.
   * Optionally filters by a subset of property IDs (custom range view picker).
   * Default sort: timeSlot asc → accommodationName asc.
   */
  async getMine(
    tenantId: string,
    userId: string,
    opts: { from?: string; to?: string; propertyIds?: string[] } = {},
  ) {
    const where: any = {
      tenantId,
      assignments: {
        some: {
          userId,
          status: { not: AssignmentStatus.REASSIGNED },
        },
      },
    };

    if (opts.from || opts.to) {
      where.timeSlot = {};
      if (opts.from) where.timeSlot.gte = new Date(opts.from);
      if (opts.to) where.timeSlot.lte = new Date(opts.to);
    }

    if (opts.propertyIds?.length) {
      where.propertyId = { in: opts.propertyIds };
    }

    return this.prisma.cleaningEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: [{ timeSlot: 'asc' }, { accommodationName: 'asc' }],
    });
  }

  async getStats(tenantId: string, date: string) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const [total, completed, pending, inProgress, overdue] = await Promise.all([
      this.prisma.cleaningEvent.count({
        where: {
          tenantId,
          timeSlot: { gte: startOfDay, lte: endOfDay },
          status: { not: 'CANCELLED' },
        },
      }),
      this.prisma.cleaningEvent.count({
        where: {
          tenantId,
          timeSlot: { gte: startOfDay, lte: endOfDay },
          status: 'COMPLETED',
        },
      }),
      this.prisma.cleaningEvent.count({
        where: {
          tenantId,
          timeSlot: { gte: startOfDay, lte: endOfDay },
          status: 'PENDING',
        },
      }),
      this.prisma.cleaningEvent.count({
        where: {
          tenantId,
          timeSlot: { gte: startOfDay, lte: endOfDay },
          status: 'IN_PROGRESS',
        },
      }),
      this.prisma.cleaningEvent.count({
        where: {
          tenantId,
          timeSlot: { gte: startOfDay, lte: endOfDay },
          status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
          checkInTime: { lte: new Date() },
        },
      }),
    ]);

    return { total, completed, pending, inProgress, overdue };
  }

  // ─── MUTATIONS ─────────────────────────────────────────────

  async create(tenantId: string, dto: CreateEventDto) {
    return this.prisma.cleaningEvent.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        bookingRef: dto.bookingRef,
        pmsBookingId: dto.pmsBookingId,
        checkInTime: new Date(dto.checkInTime),
        checkOutTime: dto.checkOutTime ? new Date(dto.checkOutTime) : null,
        accommodationName: dto.accommodationName,
        numAdults: dto.numAdults || 1,
        numChildren: dto.numChildren || 0,
        channel: dto.channel || BookingChannel.OTHER,
        cleaningType: dto.cleaningType || CleaningType.CHECKOUT,
        timeSlot: new Date(dto.timeSlot),
        managerNote: dto.managerNote,
        maxCleaners: dto.maxCleaners ?? 1,
        status: CleaningEventStatus.PENDING,
      },
      include: EVENT_INCLUDE,
    });
  }

  async update(tenantId: string, eventId: string, dto: UpdateEventDto) {
    const existing = await this.findById(tenantId, eventId);

    // If maxCleaners is being reduced, make sure it's not below current active count
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

    const updated = await this.prisma.cleaningEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.checkInTime && { checkInTime: new Date(dto.checkInTime) }),
        ...(dto.timeSlot && { timeSlot: new Date(dto.timeSlot) }),
        ...(dto.cleaningType && { cleaningType: dto.cleaningType }),
        ...(dto.managerNote !== undefined && { managerNote: dto.managerNote }),
        ...(dto.supplyNote !== undefined && { supplyNote: dto.supplyNote }),
        ...(dto.maxCleaners !== undefined && { maxCleaners: dto.maxCleaners }),
      },
      include: EVENT_INCLUDE,
    });

    const checkInChanged =
      dto.checkInTime &&
      new Date(dto.checkInTime).toISOString() !== existing.checkInTime.toISOString();
    const timeSlotChanged =
      dto.timeSlot &&
      new Date(dto.timeSlot).toISOString() !== existing.timeSlot.toISOString();

    if (checkInChanged || timeSlotChanged) {
      const activeAssignments = existing.assignments.filter((a) =>
        ['ASSIGNED', 'STARTED'].includes(a.status as string),
      );
      for (const assignment of activeAssignments) {
        await this.prisma.notification.create({
          data: {
            tenantId,
            userId: assignment.userId,
            type: 'BOOKING_MODIFIED' as any,
            channel: 'IN_APP',
            title: 'Schedule Updated',
            body: `Time updated for ${existing.accommodationName}. Please check your new schedule.`,
            payload: { eventId },
          },
        });
      }
    }

    this.gateway.notifyEventUpdated(tenantId, updated);
    return updated;
  }

  async cancel(tenantId: string, eventId: string) {
    const event = await this.findById(tenantId, eventId);
    if (event.status === CleaningEventStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed event');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const ev = await tx.cleaningEvent.update({
        where: { id: eventId },
        data: {
          status: CleaningEventStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        include: EVENT_INCLUDE,
      });

      await tx.cleaningAssignment.updateMany({
        where: {
          cleaningEventId: eventId,
          status: { in: ACTIVE_STATUSES },
        },
        data: { status: AssignmentStatus.REASSIGNED },
      });

      return ev;
    });

    this.gateway.notifyEventCancelled(tenantId, updated);
    return updated;
  }

  // ─── POOL LIFECYCLE ─────────────────────────────────────────

  /**
   * Cleaner claims an event from the pool.
   * Atomic via Serializable isolation — concurrent claimers can't both win.
   */
  async claim(tenantId: string, userId: string, eventId: string) {
    let result;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const event = await tx.cleaningEvent.findFirst({
            where: { id: eventId, tenantId },
            include: {
              assignments: {
                where: { status: { in: ACTIVE_STATUSES } },
              },
            },
          });

          if (!event) {
            throw new NotFoundException('Cleaning event not found');
          }
          if (event.status !== CleaningEventStatus.PENDING) {
            throw new BadRequestException('Event is not in the pool');
          }

          const alreadyMine = event.assignments.find((a) => a.userId === userId);
          if (alreadyMine) {
            throw new BadRequestException('You already claimed this event');
          }

          const activeCount = event.assignments.length;
          if (activeCount >= event.maxCleaners) {
            throw new BadRequestException('Event is already full');
          }

          const isPrimary = activeCount === 0;
          const newCount = activeCount + 1;

          const assignment = await tx.cleaningAssignment.create({
            data: {
              cleaningEventId: eventId,
              userId,
              isPrimary,
              status: AssignmentStatus.ASSIGNED,
            },
          });

          // If this claim fills the event, flip status out of PENDING
          if (newCount >= event.maxCleaners) {
            await tx.cleaningEvent.update({
              where: { id: eventId },
              data: { status: CleaningEventStatus.ASSIGNED },
            });
          }

          await tx.auditEvent.create({
            data: {
              tenantId,
              category: AuditCategory.CLEANING_LIFECYCLE,
              action: 'cleaning.claimed',
              actorId: userId,
              targetType: 'CleaningEvent',
              targetId: eventId,
              metadata: {
                accommodationName: event.accommodationName,
                bookingRef: event.bookingRef,
                isPrimary,
                filledEvent: newCount >= event.maxCleaners,
              } as any,
            },
          });

          return { assignment, filled: newCount >= event.maxCleaners };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err: any) {
      // Postgres serialization failure → concurrent claimer beat us
      if (err?.code === 'P2034') {
        throw new BadRequestException(
          'Another cleaner claimed it first — please try another',
        );
      }
      throw err;
    }

    // Load the updated event and broadcast
    const freshEvent = await this.findById(tenantId, eventId);
    this.gateway.notifyEventUpdated(tenantId, freshEvent);

    return { cleaning: freshEvent, assignment: result.assignment };
  }

  /**
   * Cleaner drops an event they previously claimed.
   * Blocked within DROP_CUTOFF_HOURS of timeSlot.
   */
  async drop(tenantId: string, userId: string, eventId: string) {
    const freshEvent = await this.prisma.$transaction(async (tx) => {
      const event = await tx.cleaningEvent.findFirst({
        where: { id: eventId, tenantId },
        include: {
          assignments: {
            where: { status: { in: ACTIVE_STATUSES } },
          },
        },
      });

      if (!event) throw new NotFoundException('Cleaning event not found');

      const hoursUntil =
        (event.timeSlot.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntil < DROP_CUTOFF_HOURS) {
        throw new BadRequestException(
          `Cannot drop within ${DROP_CUTOFF_HOURS} hours of the scheduled time`,
        );
      }

      const mine = event.assignments.find((a) => a.userId === userId);
      if (!mine) {
        throw new BadRequestException('You are not assigned to this event');
      }

      await tx.cleaningAssignment.update({
        where: { id: mine.id },
        data: { status: AssignmentStatus.REASSIGNED },
      });

      const remaining = event.assignments.filter((a) => a.id !== mine.id);

      // If the primary dropped and others remain, promote the oldest remaining
      if (mine.isPrimary && remaining.length > 0) {
        const [nextPrimary] = remaining;
        await tx.cleaningAssignment.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }

      // Event always goes back to PENDING when someone drops —
      // there's now a free slot regardless of how many remain
      await tx.cleaningEvent.update({
        where: { id: eventId },
        data: { status: CleaningEventStatus.PENDING },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.CLEANING_LIFECYCLE,
          action: 'cleaning.dropped',
          actorId: userId,
          targetType: 'CleaningEvent',
          targetId: eventId,
          metadata: {
            accommodationName: event.accommodationName,
            bookingRef: event.bookingRef,
            wasPrimary: mine.isPrimary,
            remainingCount: remaining.length,
          } as any,
        },
      });

      return tx.cleaningEvent.findFirst({
        where: { id: eventId },
        include: EVENT_INCLUDE,
      });
    });

    if (freshEvent) {
      this.gateway.notifyEventUpdated(tenantId, freshEvent);
    }
    return { dropped: true, cleaning: freshEvent };
  }

  /**
   * Cleaner marks their work on an event as done.
   * - allGood: true → just completes the assignment
   * - allGood: false → requires priority, attaches note + photos,
   *   auto-creates an Incident (type=CLEANING, status=OPEN, priority from DTO)
   *
   * When every active assignment on the event is completed, the event
   * itself flips to COMPLETED.
   */
  async markDone(
    tenantId: string,
    userId: string,
    eventId: string,
    dto: MarkDoneDto,
  ) {
    // Validate priority up front
    if (!dto.allGood && !dto.priority) {
      throw new BadRequestException(
        'priority is required when reporting an issue',
      );
    }

    // Fetch actor email for incident audit trail
    const actorUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true },
    });

    const { freshEvent, needsIncident } = await this.prisma.$transaction(
      async (tx) => {
        const event = await tx.cleaningEvent.findFirst({
          where: { id: eventId, tenantId },
          include: {
            assignments: true,
          },
        });

        if (!event) throw new NotFoundException('Cleaning event not found');

        const mine = event.assignments.find(
          (a) => a.userId === userId && ACTIVE_STATUSES.includes(a.status),
        );
        if (!mine) {
          throw new BadRequestException('You are not actively assigned to this event');
        }

        const now = new Date();

        await tx.cleaningAssignment.update({
          where: { id: mine.id },
          data: {
            status: AssignmentStatus.COMPLETED,
            completedAt: now,
          },
        });

        if (!dto.allGood) {
          if (dto.note) {
            await tx.cleaningEvent.update({
              where: { id: eventId },
              data: { cleanerNote: dto.note },
            });
          }
          if (dto.photoUrls && dto.photoUrls.length > 0) {
            for (const url of dto.photoUrls) {
              await tx.cleaningPhoto.create({
                data: {
                  cleaningEventId: eventId,
                  cleaningAssignmentId: mine.id,
                  url,
                },
              });
            }
          }
        }

        // Check if all other active assignments are done too
        const stillActive = event.assignments.filter(
          (a) => a.id !== mine.id && ACTIVE_STATUSES.includes(a.status),
        );

        if (stillActive.length === 0) {
          await tx.cleaningEvent.update({
            where: { id: eventId },
            data: {
              status: CleaningEventStatus.COMPLETED,
              completedAt: now,
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            tenantId,
            category: AuditCategory.CLEANING_LIFECYCLE,
            action: dto.allGood ? 'cleaning.done' : 'cleaning.done_with_issue',
            actorId: userId,
            actorEmail: actorUser?.email ?? null,
            targetType: 'CleaningEvent',
            targetId: eventId,
            metadata: {
              accommodationName: event.accommodationName,
              bookingRef: event.bookingRef,
              allGood: dto.allGood,
              hasNote: !!dto.note,
              photoCount: dto.photoUrls?.length ?? 0,
              eventCompleted: stillActive.length === 0,
              priority: dto.priority ?? null,
            } as any,
          },
        });

        const fresh = await tx.cleaningEvent.findFirst({
          where: { id: eventId },
          include: EVENT_INCLUDE,
        });

        return { freshEvent: fresh, needsIncident: !dto.allGood };
      },
    );

    if (freshEvent) {
      this.gateway.notifyEventUpdated(tenantId, freshEvent);
    }

    // Auto-create the incident OUTSIDE the main transaction
    // (the incident service runs its own transaction + emits its own socket event)
    let incidentId: string | null = null;
    if (!dto.allGood && dto.priority) {
      const incident = await this.incidents.createFromCleaningDone(
        tenantId,
        {
          userId,
          userRole: actorUser?.role ?? 'CLEANER',
          userEmail: actorUser?.email,
        },
        {
          cleaningEventId: eventId,
          priority: dto.priority,
          note: dto.note,
          photoUrls: dto.photoUrls,
        },
      );
      incidentId = incident.id;
    }

    return {
      done: true,
      needsIncident,
      incidentId,
      cleaning: freshEvent,
    };
  }

  /**
   * Manager releases an assigned event back to the pool.
   * All current assignments are dropped, event status → PENDING,
   * each affected cleaner is notified.
   */
  async releaseToPool(tenantId: string, managerId: string, eventId: string) {
    const { freshEvent, affected } = await this.prisma.$transaction(
      async (tx) => {
        const event = await tx.cleaningEvent.findFirst({
          where: { id: eventId, tenantId },
          include: {
            assignments: {
              where: { status: { in: ACTIVE_STATUSES } },
            },
          },
        });

        if (!event) throw new NotFoundException('Cleaning event not found');
        if (event.status === CleaningEventStatus.COMPLETED) {
          throw new BadRequestException('Cannot release a completed event');
        }
        if (event.status === CleaningEventStatus.CANCELLED) {
          throw new BadRequestException('Cannot release a cancelled event');
        }

        const affectedUserIds = event.assignments.map((a) => a.userId);

        await tx.cleaningAssignment.updateMany({
          where: {
            cleaningEventId: eventId,
            status: { in: ACTIVE_STATUSES },
          },
          data: { status: AssignmentStatus.REASSIGNED },
        });

        await tx.cleaningEvent.update({
          where: { id: eventId },
          data: { status: CleaningEventStatus.PENDING },
        });

        // Notification rows for each affected cleaner
        for (const uid of affectedUserIds) {
          await tx.notification.create({
            data: {
              tenantId,
              userId: uid,
              type: 'REASSIGNMENT' as any,
              channel: 'IN_APP',
              title: 'Cleaning returned to pool',
              body: `A manager returned ${event.accommodationName} to the pool.`,
              payload: { eventId },
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            tenantId,
            category: AuditCategory.CLEANING_LIFECYCLE,
            action: 'cleaning.released_to_pool',
            actorId: managerId,
            targetType: 'CleaningEvent',
            targetId: eventId,
            metadata: {
              accommodationName: event.accommodationName,
              bookingRef: event.bookingRef,
              affectedUserIds,
            } as any,
          },
        });

        const fresh = await tx.cleaningEvent.findFirst({
          where: { id: eventId },
          include: EVENT_INCLUDE,
        });

        return { freshEvent: fresh, affected: affectedUserIds };
      },
    );

    // Socket broadcasts — outside the transaction
    if (freshEvent) {
      this.gateway.notifyEventUpdated(tenantId, freshEvent);
      for (const uid of affected) {
        this.gateway.emitToUser(uid, 'assignment:released', { eventId });
      }
    }

    return { released: true, affectedUserIds: affected, cleaning: freshEvent };
  }

  // ─── PMS SYNC ──────────────────────────────────────────────

  async upsertFromPms(
    tenantId: string,
    pmsBookingId: string,
    data: Partial<CreateEventDto> & { pmsRawData?: any },
  ) {
    const existing = await this.prisma.cleaningEvent.findFirst({
      where: { tenantId, pmsBookingId },
    });

    if (existing) {
      return this.prisma.cleaningEvent.update({
        where: { id: existing.id },
        data: {
          checkInTime: data.checkInTime ? new Date(data.checkInTime) : undefined,
          checkOutTime: data.checkOutTime ? new Date(data.checkOutTime) : undefined,
          accommodationName: data.accommodationName,
          numAdults: data.numAdults,
          numChildren: data.numChildren,
          channel: data.channel,
          pmsLastSyncedAt: new Date(),
          pmsRawData: data.pmsRawData || undefined,
        },
        include: EVENT_INCLUDE,
      });
    } else {
      return this.create(tenantId, {
        propertyId: data.propertyId!,
        bookingRef: data.bookingRef!,
        pmsBookingId,
        checkInTime: data.checkInTime!,
        checkOutTime: data.checkOutTime,
        accommodationName: data.accommodationName!,
        numAdults: data.numAdults,
        numChildren: data.numChildren,
        channel: data.channel,
        cleaningType: data.cleaningType,
        timeSlot: data.timeSlot || data.checkInTime!,
      });
    }
  }

  // ─── OVERDUE / CALENDAR ────────────────────────────────────

  async getOverdueEvents(tenantId: string, thresholdMinutes: number = 60) {
    const threshold = new Date(Date.now() + thresholdMinutes * 60 * 1000);
    return this.prisma.cleaningEvent.findMany({
      where: {
        tenantId,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        checkInTime: { lte: threshold },
      },
      include: EVENT_INCLUDE,
      orderBy: { checkInTime: 'asc' },
    });
  }

  async getMonthSummary(tenantId: string, year: number, month: number) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const events = await this.prisma.cleaningEvent.groupBy({
      by: ['status'],
      where: {
        tenantId,
        timeSlot: { gte: startOfMonth, lte: endOfMonth },
      },
      _count: true,
    });

    const dailyCounts = await this.prisma.$queryRaw<
      Array<{ day: string; count: bigint }>
    >`
      SELECT DATE(time_slot) as day, COUNT(*) as count
      FROM cleaning_events
      WHERE tenant_id = ${tenantId}
        AND time_slot >= ${startOfMonth}
        AND time_slot <= ${endOfMonth}
        AND status != 'CANCELLED'
      GROUP BY DATE(time_slot)
      ORDER BY day
    `;

    return {
      statusCounts: events.reduce(
        (acc, e) => ({ ...acc, [e.status]: e._count }),
        {},
      ),
      dailyCounts: dailyCounts.map((d) => ({
        day: d.day,
        count: Number(d.count),
      })),
    };
  }
}
