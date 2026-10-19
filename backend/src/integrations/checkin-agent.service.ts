import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditCategory, BookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { startOfDayInAppZone, timeInAppZone, todayInAppZone } from '../common/time';
import { addDays } from '../availability/availability.service';

/**
 * Why an agent is, or is not, a fit for one arrival.
 *
 *   AVAILABLE         a declared block covers the arrival time
 *   TIME_UNCONFIRMED  the arrival time is our 15:00 guess and the agent has
 *                     declared something that day; we cannot say more yet
 *   OUTSIDE_HOURS     declared that day, but not around the arrival time
 *   NOT_DECLARED      nothing declared for that day
 */
export type AgentFit = 'AVAILABLE' | 'TIME_UNCONFIRMED' | 'OUTSIDE_HOURS' | 'NOT_DECLARED';

export const ELIGIBLE_FITS: readonly AgentFit[] = ['AVAILABLE', 'TIME_UNCONFIRMED'];

interface Block {
  day: string;
  startMinute: number;
  endMinute: number;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Pure: classify one agent for an arrival on `day` at `arrivalMinute`
 * (minutes after that day's midnight, Prague). `blocks` are the agent's blocks
 * for `day` and the day before — a block that runs past midnight on the day
 * before covers the early hours of `day`.
 */
export function classifyAgent(
  blocks: Block[],
  day: string,
  arrivalMinute: number,
  arrivalAssumed: boolean,
): AgentFit {
  const base = dayNumber(day) * 1440;
  const arrival = base + arrivalMinute;
  const onTheDay = blocks.filter((b) => b.day === day);
  const spillover = blocks.filter(
    (b) => b.day === addDays(day, -1) && b.endMinute > 1440,
  );

  const declaredThatDay = onTheDay.length > 0 || spillover.length > 0;
  if (!declaredThatDay) return 'NOT_DECLARED';
  if (arrivalAssumed) return 'TIME_UNCONFIRMED';

  const covers = [...onTheDay, ...spillover].some((b) => {
    const lo = dayNumber(b.day) * 1440 + b.startMinute;
    const hi = dayNumber(b.day) * 1440 + b.endMinute;
    return lo <= arrival && arrival < hi;
  });
  return covers ? 'AVAILABLE' : 'OUTSIDE_HOURS';
}

const FIT_ORDER: Record<AgentFit, number> = {
  AVAILABLE: 0,
  TIME_UNCONFIRMED: 1,
  OUTSIDE_HOURS: 2,
  NOT_DECLARED: 3,
};

export interface AgentOption {
  id: string;
  name: string;
  fit: AgentFit;
  eligible: boolean;
  /** "HH:mm–HH:mm" blocks the agent declared for the arrival day, for the dropdown hint. */
  declared: string[];
}

function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export type RecipientRole = 'GAINING' | 'LOSING';
export type AgentResponse = 'ACK' | 'ACCEPT' | 'DECLINE';

/**
 * What an agent may answer to a change. Losing a job, or getting one they
 * declared for, is "got it". Getting one they had NOT declared (an override)
 * is a real question: accept or decline.
 */
export function allowedResponses(role: RecipientRole, override: boolean): AgentResponse[] {
  if (role === 'GAINING' && override) return ['ACCEPT', 'DECLINE'];
  return ['ACK'];
}

@Injectable()
export class CheckInAgentService {
  constructor(
    private prisma: PrismaService,
    private gateway: CleanOpsGateway,
  ) {}

  /** Active agents for one booking's arrival, available ones first. */
  async options(tenantId: string, bookingId: string) {
    const booking = await this.loadBooking(tenantId, bookingId);
    const { day, arrivalMinute, assumed } = this.arrival(booking);

    const agents = await this.prisma.user.findMany({
      where: { tenantId, role: 'AGENT' as any, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const blocks = await this.prisma.agentAvailability.findMany({
      where: {
        tenantId,
        userId: { in: agents.map((a) => a.id) },
        day: { gte: addDays(day, -1), lte: day },
      },
      select: { userId: true, day: true, startMinute: true, endMinute: true },
    });

    const options: AgentOption[] = agents
      .map((a) => {
        const mine = blocks.filter((b) => b.userId === a.id);
        const fit = classifyAgent(mine, day, arrivalMinute, assumed);
        return {
          id: a.id,
          name: a.name,
          fit,
          eligible: ELIGIBLE_FITS.includes(fit),
          declared: mine
            .filter((b) => b.day === day)
            .map((b) => `${hhmm(b.startMinute)}–${hhmm(b.endMinute)}`),
        };
      })
      .sort((x, y) => FIT_ORDER[x.fit] - FIT_ORDER[y.fit] || x.name.localeCompare(y.name, 'cs'));

    return {
      bookingId,
      day,
      arrival: hhmm(arrivalMinute),
      arrivalAssumed: assumed,
      currentAgentId: booking.checkInAgentId,
      options,
    };
  }

  /**
   * Set or clear the booking's check-in agent. The server decides whether the
   * agent may be picked: an agent who did not declare the arrival needs
   * `override: true`, so the dropdown is a convenience, not the rule.
   *
   * One transaction writes the booking, the change record, who has to see it
   * and the audit row. Earlier unanswered changes for the same booking are
   * marked superseded so an agent only ever sees the net result.
   */
  async setAgent(
    tenantId: string,
    bookingId: string,
    actorId: string,
    dto: { agentId: string | null; override?: boolean },
  ) {
    const booking = await this.loadBooking(tenantId, bookingId);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('This booking is cancelled — there is nothing to assign');
    }

    const agentId = dto.agentId ?? null;
    if (agentId === booking.checkInAgentId) {
      return this.shape(booking, booking.checkInAgent?.name ?? null);
    }

    let agent: { id: string; name: string } | null = null;
    let fit: AgentFit | null = null;
    let override = false;

    if (agentId) {
      agent = await this.prisma.user.findFirst({
        where: { id: agentId, tenantId, role: 'AGENT' as any, isActive: true },
        select: { id: true, name: true },
      });
      if (!agent) throw new BadRequestException('That person is not an active check-in agent');

      const { day, arrivalMinute, assumed } = this.arrival(booking);
      const blocks = await this.prisma.agentAvailability.findMany({
        where: { tenantId, userId: agentId, day: { gte: addDays(day, -1), lte: day } },
        select: { day: true, startMinute: true, endMinute: true },
      });
      fit = classifyAgent(blocks, day, arrivalMinute, assumed);
      if (!ELIGIBLE_FITS.includes(fit)) {
        if (dto.override !== true) {
          throw new ConflictException({
            code: 'AGENT_NOT_AVAILABLE',
            fit,
            message: `${agent.name} has not declared availability for this arrival`,
          });
        }
        override = true;
      }
    }

    const previous = booking.checkInAgent ?? null;
    const now = new Date();
    const notify: string[] = [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.booking.update({
        where: { id: booking.id },
        data: {
          checkInAgentId: agentId,
          checkInAgentAssignedById: agentId ? actorId : null,
          checkInAgentAssignedAt: agentId ? now : null,
          checkInAgentOverride: override,
          checkInAgentConsent: (override ? 'PENDING' : 'NOT_REQUIRED') as any,
          checkInDeclinedAgentName: null,
          checkInDeclinedAt: null,
        },
        select: {
          id: true, bookingRef: true, accommodationName: true, checkInTime: true,
          checkInAgentId: true, checkInAgentAssignedAt: true, checkInAgentOverride: true,
        },
      });

      // The agent who loses the job is told only if they were ever told they had it.
      const losing = previous
        ? await tx.checkInChangeRecipient.findFirst({
            where: {
              tenantId, userId: previous.id, role: 'GAINING',
              change: { bookingId: booking.id },
            },
            select: { id: true },
          })
        : null;

      await tx.checkInAssignmentChange.updateMany({
        where: { tenantId, bookingId: booking.id, supersededAt: null },
        data: { supersededAt: now },
      });

      const kind = !agentId ? 'UNASSIGNED' : previous ? 'REASSIGNED' : 'ASSIGNED';
      const recipients: Array<{ tenantId: string; userId: string; role: RecipientRole }> = [];
      if (agent) recipients.push({ tenantId, userId: agent.id, role: 'GAINING' });
      if (previous && losing) recipients.push({ tenantId, userId: previous.id, role: 'LOSING' });

      // Never the check-in link: it is a bearer token to guest registration.
      const snapshot = {
        bookingRef: booking.bookingRef,
        accommodationName: booking.accommodationName,
        arrival: booking.checkInTime.toISOString(),
        arrivalAssumed: booking.checkInSource === 'FALLBACK',
        fit,
      };

      await tx.checkInAssignmentChange.create({
        data: {
          tenantId,
          bookingId: booking.id,
          kind: kind as any,
          fromAgentId: previous?.id ?? null,
          toAgentId: agent?.id ?? null,
          changedById: actorId,
          override,
          snapshot: snapshot as any,
          changedAt: now,
          recipients: { create: recipients as any },
        },
      });
      notify.push(...recipients.map((r) => r.userId));

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.ASSIGNMENT_LIFECYCLE,
          action: !agentId
            ? 'checkin.agent_unassigned'
            : previous
              ? 'checkin.agent_reassigned'
              : 'checkin.agent_assigned',
          actorId,
          targetType: 'Booking',
          targetId: booking.id,
          metadata: {
            bookingRef: booking.bookingRef,
            accommodationName: booking.accommodationName,
            arrival: booking.checkInTime.toISOString(),
            arrivalAssumed: booking.checkInSource === 'FALLBACK',
            fromAgentId: previous?.id ?? null,
            fromAgentName: previous?.name ?? null,
            toAgentId: agent?.id ?? null,
            toAgentName: agent?.name ?? null,
            fit,
            override,
            notified: recipients.map((r) => ({ userId: r.userId, role: r.role })),
          } as any,
        },
      });
      return row;
    });

    this.nudge(tenantId, booking.id, notify);
    return this.shape(updated, agent?.name ?? null);
  }

  /**
   * The desk records that an override was agreed on the phone. Same effect as
   * the agent pressing Accept, logged as the desk user's act.
   */
  async agreeByPhone(tenantId: string, bookingId: string, actorId: string) {
    const booking = await this.loadBooking(tenantId, bookingId);
    if (!booking.checkInAgentId || booking.checkInAgentConsent !== ('PENDING' as any)) {
      throw new ConflictException('Nothing is waiting for the agent\'s answer on this booking');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { checkInAgentConsent: 'PHONE' as any },
      });
      await tx.checkInChangeRecipient.updateMany({
        where: {
          tenantId, userId: booking.checkInAgentId!, role: 'GAINING', ackedAt: null,
          change: { bookingId: booking.id, supersededAt: null },
        },
        data: { ackedAt: now, response: 'PHONE' as any, via: 'DESK', recordedById: actorId },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.ASSIGNMENT_LIFECYCLE,
          action: 'checkin.consent_phone',
          actorId,
          targetType: 'Booking',
          targetId: booking.id,
          metadata: {
            bookingRef: booking.bookingRef,
            agentId: booking.checkInAgentId,
            agentName: booking.checkInAgent?.name ?? null,
            via: 'DESK',
          } as any,
        },
      });
    });
    this.nudge(tenantId, booking.id, [booking.checkInAgentId]);
    return { ok: true, checkInAgentConsent: 'PHONE' };
  }

  // ─── Agent: their own check-ins and what they have to answer ───────────────

  /** Upcoming check-ins assigned to this agent, and the changes waiting for their answer. */
  async mine(tenantId: string, userId: string) {
    const from = startOfDayInAppZone(todayInAppZone());
    const [bookings, pending] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          tenantId, checkInAgentId: userId, status: BookingStatus.CONFIRMED,
          checkInTime: { gte: from },
        },
        orderBy: { checkInTime: 'asc' },
        take: 200,
        select: {
          id: true, bookingRef: true, accommodationName: true, checkInTime: true,
          checkInSource: true, numAdults: true, numChildren: true,
          checkInAgentConsent: true,
          // The assigned agent may open guest registration; nobody else on this API may.
          checkInLinkUrl: true,
        },
      }),
      this.pendingFor(tenantId, userId),
    ]);

    return {
      today: todayInAppZone(),
      items: bookings.map((b) => ({
        id: b.id,
        bookingRef: b.bookingRef,
        accommodationName: b.accommodationName,
        day: todayInAppZone(b.checkInTime),
        time: timeInAppZone(b.checkInTime),
        arrivalAssumed: b.checkInSource === 'FALLBACK',
        numAdults: b.numAdults,
        numChildren: b.numChildren,
        awaitingMyAnswer: b.checkInAgentConsent === ('PENDING' as any),
        checkInLinkUrl: b.checkInLinkUrl ?? null,
      })),
      pending,
    };
  }

  async pendingCount(tenantId: string, userId: string) {
    const count = await this.prisma.checkInChangeRecipient.count({
      where: { tenantId, userId, ackedAt: null, change: { supersededAt: null } },
    });
    return { count };
  }

  /**
   * The agent answers one change. Strict about which answer fits: an override
   * needs accept or decline, everything else is "got it".
   */
  async respond(tenantId: string, userId: string, recipientId: string, response: string) {
    const rec = await this.prisma.checkInChangeRecipient.findFirst({
      where: { id: recipientId, tenantId, userId },
      include: { change: true },
    });
    if (!rec) throw new NotFoundException('Nothing to answer');
    if (rec.ackedAt) return { ok: true, already: true };
    if (rec.change.supersededAt) {
      throw new ConflictException({
        code: 'CHANGE_SUPERSEDED',
        message: 'This was replaced by a newer change — reload',
      });
    }

    const role = rec.role as RecipientRole;
    const allowed = allowedResponses(role, rec.change.override);
    if (!allowed.includes(response as AgentResponse)) {
      throw new BadRequestException(`Answer must be one of: ${allowed.join(', ')}`);
    }

    const booking = await this.prisma.booking.findFirst({
      where: { id: rec.change.bookingId, tenantId },
      select: { id: true, bookingRef: true, accommodationName: true, checkInAgentId: true },
    });
    const me = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { name: true },
    });
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.checkInChangeRecipient.update({
        where: { id: rec.id },
        data: { ackedAt: now, response: response as any, via: 'APP', recordedById: userId },
      });

      let action = 'checkin.change_acknowledged';

      if (response === 'ACCEPT' && booking) {
        await tx.booking.updateMany({
          where: { id: booking.id, checkInAgentId: userId, checkInAgentConsent: 'PENDING' as any },
          data: { checkInAgentConsent: 'ACCEPTED' as any },
        });
        action = 'checkin.consent_accepted';
      }

      if (response === 'DECLINE' && booking) {
        // Only if the job is still theirs; if the desk already moved on, the
        // answer is recorded and nothing else changes.
        await tx.booking.updateMany({
          where: { id: booking.id, checkInAgentId: userId },
          data: {
            checkInAgentId: null,
            checkInAgentAssignedById: null,
            checkInAgentAssignedAt: null,
            checkInAgentOverride: false,
            checkInAgentConsent: 'NOT_REQUIRED' as any,
            checkInDeclinedAgentName: me?.name ?? null,
            checkInDeclinedAt: now,
          },
        });
        action = 'checkin.consent_declined';
      }

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.ASSIGNMENT_LIFECYCLE,
          action,
          actorId: userId,
          targetType: 'Booking',
          targetId: rec.change.bookingId,
          metadata: {
            bookingRef: booking?.bookingRef ?? null,
            accommodationName: booking?.accommodationName ?? null,
            changeId: rec.changeId,
            role,
            response,
            via: 'APP',
          } as any,
        },
      });
    });

    this.nudge(tenantId, rec.change.bookingId, []);
    return { ok: true };
  }

  /** Planning rows: for each booking, the state of the current agent's answer. */
  async ackStateFor(tenantId: string, bookingIds: string[]) {
    if (!bookingIds.length) return new Map<string, { userId: string; ackedAt: Date | null; response: string | null; changedAt: Date }>();
    const rows = await this.prisma.checkInChangeRecipient.findMany({
      where: { tenantId, role: 'GAINING', change: { bookingId: { in: bookingIds }, supersededAt: null } },
      select: {
        userId: true, ackedAt: true, response: true,
        change: { select: { bookingId: true, changedAt: true } },
      },
    });
    const out = new Map<string, { userId: string; ackedAt: Date | null; response: string | null; changedAt: Date }>();
    for (const r of rows) {
      out.set(r.change.bookingId, {
        userId: r.userId,
        ackedAt: r.ackedAt,
        response: (r.response as string | null) ?? null,
        changedAt: r.change.changedAt,
      });
    }
    return out;
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async loadBooking(tenantId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      select: {
        id: true, bookingRef: true, status: true, accommodationName: true,
        checkInTime: true, checkInSource: true,
        checkInAgentId: true, checkInAgentAssignedAt: true, checkInAgentOverride: true,
        checkInAgentConsent: true,
        checkInAgent: { select: { id: true, name: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async pendingFor(tenantId: string, userId: string) {
    const rows = await this.prisma.checkInChangeRecipient.findMany({
      where: { tenantId, userId, ackedAt: null, change: { supersededAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, role: true,
        change: { select: { kind: true, override: true, changedAt: true, snapshot: true, bookingId: true } },
      },
    });
    return rows.map((r) => {
      const snap = (r.change.snapshot ?? {}) as any;
      const arrival = snap.arrival ? new Date(snap.arrival) : null;
      return {
        id: r.id,
        role: r.role as RecipientRole,
        kind: r.change.kind as string,
        override: r.change.override,
        changedAt: r.change.changedAt,
        bookingId: r.change.bookingId,
        bookingRef: snap.bookingRef ?? null,
        accommodationName: snap.accommodationName ?? null,
        day: arrival ? todayInAppZone(arrival) : null,
        time: arrival ? timeInAppZone(arrival) : null,
        arrivalAssumed: !!snap.arrivalAssumed,
        answers: allowedResponses(r.role as RecipientRole, r.change.override),
      };
    });
  }

  /** A nudge, not the data: clients refetch. Office rooms get the booking id. */
  private nudge(tenantId: string, bookingId: string, userIds: Array<string | null>) {
    const at = new Date().toISOString();
    for (const uid of new Set(userIds.filter((u): u is string => !!u))) {
      this.gateway.emitToUser(uid, 'checkin:changed', { at });
    }
    this.gateway.emitToTenant(tenantId, 'checkin:changed', { bookingId, at });
  }

  private arrival(booking: { checkInTime: Date; checkInSource: any }) {
    const day = todayInAppZone(booking.checkInTime);
    const time = timeInAppZone(booking.checkInTime);
    return {
      day,
      arrivalMinute: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)),
      assumed: booking.checkInSource === 'FALLBACK',
    };
  }

  private shape(
    b: { checkInAgentId: string | null; checkInAgentAssignedAt: Date | null; checkInAgentOverride: boolean },
    name: string | null,
  ) {
    return {
      checkInAgentId: b.checkInAgentId,
      checkInAgentName: name,
      checkInAgentAssignedAt: b.checkInAgentAssignedAt,
      checkInAgentOverride: b.checkInAgentOverride,
    };
  }
}
