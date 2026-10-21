import { Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, AuditCategory, BookingStatus, TurnoverStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { forgetAccountStatus } from '../common/guards/auth.guard';

/** Assignment statuses that hold a slot on a turnover (same as TurnoversService). */
const ACTIVE: AssignmentStatus[] = [AssignmentStatus.ASSIGNED, AssignmentStatus.STARTED];
/** A turnover in one of these is finished or gone — what was done stays credited to the person. */
const FINISHED: TurnoverStatus[] = [
  TurnoverStatus.COMPLETED, TurnoverStatus.FLAGGED, TurnoverStatus.CANCELLED, TurnoverStatus.SKIPPED,
];

export type ReleaseTrigger = 'app' | 'staff_sync' | 'sweep';

export interface ReleaseResult {
  userId: string;
  turnoversReleased: number;
  turnoversBackToPool: number;
  checkInsUnassigned: number;
  taskWaitsCleared: number;
}

/**
 * What happens when a person stops working here (isActive = false), 21 Oct 2026.
 *
 * 1. Access: login already refuses an inactive account and every request checks
 *    it (AuthGuard). Here the cached status is dropped and open sockets are
 *    closed, so the app logs them out at once instead of within a minute.
 * 2. Cleanings: every turnover they hold that is not finished loses them. With
 *    nobody else on it, it goes back to the pool (PENDING) for anyone to take;
 *    with a colleague still on it, the colleague stays (and becomes primary).
 * 3. Check-ins (agents): arrivals from now on lose them and show "no agent" in
 *    Planning, so they land in Needs attention.
 * 4. Tasks: open "waiting on" them is cleared; as assignees they already count
 *    for nothing, and a task with nobody active left falls back to its creator.
 *
 * Finished work is never touched: completed cleanings and past check-ins stay
 * credited to the person. Runs from three places: the app (Users), the staff
 * sync, and a sweep every 10 minutes for deactivations made straight in the
 * database. Running it twice does nothing the second time.
 */
@Injectable()
export class OffboardingService {
  private readonly log = new Logger(OffboardingService.name);

  constructor(private readonly prisma: PrismaService, private readonly gateway: CleanOpsGateway) {}

  async release(tenantId: string, userId: string, trigger: ReleaseTrigger, actorId: string | null = null): Promise<ReleaseResult | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, isActive: true, name: true, email: true, disabledAt: true },
    });
    if (!user || user.isActive) return null;

    forgetAccountStatus(userId);
    this.gateway.disconnectUser(userId);
    if (!user.disabledAt) {
      await this.prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    }

    const result: ReleaseResult = { userId, turnoversReleased: 0, turnoversBackToPool: 0, checkInsUnassigned: 0, taskWaitsCleared: 0 };
    const meta = { trigger, userName: user.name, userEmail: user.email };

    // ── Cleanings ──
    const held = await this.prisma.turnoverAssignment.findMany({
      where: {
        userId,
        status: { in: ACTIVE },
        turnover: { tenantId, supersededById: null, status: { notIn: FINISHED } },
      },
      select: { id: true, turnoverId: true },
    });
    const touched: Array<{ id: string; status: TurnoverStatus }> = [];
    for (const h of held) {
      const out = await this.prisma.$transaction(async (tx) => {
        const t = await tx.turnover.findFirst({
          where: { id: h.turnoverId, tenantId },
          include: {
            assignments: { where: { status: { in: ACTIVE } } },
            toBooking: { select: { bookingRef: true, accommodationName: true } },
            fromBooking: { select: { bookingRef: true, accommodationName: true } },
          },
        });
        const mine = t?.assignments.find((a) => a.id === h.id);
        if (!t || !mine || FINISHED.includes(t.status)) return null;

        await tx.turnoverAssignment.update({ where: { id: mine.id }, data: { status: AssignmentStatus.REASSIGNED } });
        const remaining = t.assignments.filter((a) => a.id !== mine.id);
        let status = t.status;
        if (remaining.length === 0) {
          status = TurnoverStatus.PENDING;
          await tx.turnover.update({ where: { id: t.id }, data: { status, startedAt: null } });
        } else if (mine.isPrimary) {
          await tx.turnoverAssignment.update({ where: { id: remaining[0].id }, data: { isPrimary: true } });
        }
        await tx.auditEvent.create({
          data: {
            tenantId,
            category: AuditCategory.ASSIGNMENT_LIFECYCLE,
            action: 'turnover.released_user_deactivated',
            actorId,
            actorEmail: actorId ? undefined : 'system',
            targetType: 'Turnover',
            targetId: t.id,
            metadata: {
              ...meta,
              removedUserId: userId,
              wasStarted: mine.status === AssignmentStatus.STARTED,
              returnedToPool: remaining.length === 0,
              bookingRef: t.toBooking?.bookingRef ?? t.fromBooking?.bookingRef ?? null,
              accommodationName: t.toBooking?.accommodationName ?? t.fromBooking?.accommodationName ?? null,
            } as any,
          },
        });
        return { id: t.id, status, toPool: remaining.length === 0 };
      });
      if (out) {
        result.turnoversReleased++;
        if (out.toPool) result.turnoversBackToPool++;
        touched.push({ id: out.id, status: out.status });
      }
    }
    for (const t of touched) this.gateway.notifyEventUpdated(tenantId, { id: t.id, status: t.status, source: 'offboarding' });

    // ── Check-ins (agents): arrivals from now on ──
    const now = new Date();
    const bookings = await this.prisma.booking.findMany({
      where: { tenantId, checkInAgentId: userId, status: BookingStatus.CONFIRMED, checkInTime: { gte: now } },
      select: { id: true, bookingRef: true, accommodationName: true },
    });
    for (const b of bookings) {
      await this.prisma.$transaction(async (tx) => {
        const n = await tx.booking.updateMany({
          where: { id: b.id, checkInAgentId: userId },
          data: {
            checkInAgentId: null,
            checkInAgentAssignedById: null,
            checkInAgentAssignedAt: null,
            checkInAgentOverride: false,
            checkInAgentConsent: 'NOT_REQUIRED' as any,
          },
        });
        if (!n.count) return;
        await tx.checkInAssignmentChange.updateMany({
          where: { tenantId, bookingId: b.id, supersededAt: null },
          data: { supersededAt: now },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            category: AuditCategory.ASSIGNMENT_LIFECYCLE,
            action: 'checkin.agent_released_user_deactivated',
            actorId,
            actorEmail: actorId ? undefined : 'system',
            targetType: 'Booking',
            targetId: b.id,
            metadata: { ...meta, removedUserId: userId, bookingRef: b.bookingRef, accommodationName: b.accommodationName } as any,
          },
        });
        result.checkInsUnassigned++;
      });
    }
    if (result.checkInsUnassigned) this.gateway.emitToTenant(tenantId, 'checkin:changed', { at: now.toISOString() });

    // ── Tasks: nobody waits on someone who has left ──
    const waits = await this.prisma.taskWait.updateMany({
      where: { userId, resolvedAt: null, task: { tenantId } },
      data: { resolvedAt: now, resolvedReason: 'cleared' },
    });
    result.taskWaitsCleared = waits.count;
    if (waits.count) this.gateway.emitToTenant(tenantId, 'tasks:changed', { at: now.toISOString() });

    const any = result.turnoversReleased + result.checkInsUnassigned + result.taskWaitsCleared;
    if (any || trigger !== 'sweep') {
      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.SYSTEM,
          action: 'user.offboarded',
          actorId,
          actorEmail: actorId ? undefined : 'system',
          targetType: 'User',
          targetId: userId,
          metadata: { ...meta, ...result } as any,
        },
      });
      this.log.log(`Offboarded ${user.email} (${trigger}): ${result.turnoversReleased} cleanings released (${result.turnoversBackToPool} to pool), ${result.checkInsUnassigned} check-ins, ${result.taskWaitsCleared} task waits`);
    }
    return result;
  }

  /**
   * Inactive people who still hold something open — for deactivations made
   * outside the app (Neon SQL editor, imports). Every tenant.
   */
  async sweep(): Promise<ReleaseResult[]> {
    const now = new Date();
    const people = await this.prisma.user.findMany({
      where: {
        isActive: false,
        OR: [
          { assignedTurnovers: { some: { status: { in: ACTIVE }, turnover: { supersededById: null, status: { notIn: FINISHED } } } } },
          { checkInBookings: { some: { status: BookingStatus.CONFIRMED, checkInTime: { gte: now } } } },
          { taskWaitsOnMe: { some: { resolvedAt: null } } },
        ],
      },
      select: { id: true, tenantId: true },
      take: 200,
    });
    const out: ReleaseResult[] = [];
    for (const p of people) {
      try {
        const r = await this.release(p.tenantId, p.id, 'sweep');
        if (r) out.push(r);
      } catch (e: any) {
        this.log.error(`Offboarding sweep failed for user ${p.id}: ${e?.message ?? e}`);
      }
    }
    return out;
  }
}
