import { propertyInArea } from '../common/area';
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
import { addDays, isLocked } from '../availability/availability.service';
import { guestNameFromRaw, guestPhoneFromRaw } from './booking-sync.service';

/** Aspects of the apartment's readiness the agent rates, 1–5. */
export const RATING_ASPECTS = ['CLEANLINESS'] as const;
export type RatingAspect = (typeof RATING_ASPECTS)[number];
/** A score below this needs a comment saying what was wrong. */
export const LOW_SCORE = 3;
/** The agent can report from the arrival day until this many days after. */
const REPORT_WINDOW_DAYS = 14;
/** The agent's list keeps check-ins this many days back, so a report can follow the next day. */
const MINE_LOOKBACK_DAYS = 2;

export interface ReportDto {
  comment?: string | null;
  ratings?: Array<{ aspect?: string; score?: unknown; comment?: string | null }>;
}

/**
 * Pure: check and normalise a report. Every aspect must be rated exactly once,
 * 1–5; below LOW_SCORE the rating needs a comment of its own.
 */
export function validateReport(dto: ReportDto): {
  comment: string | null;
  ratings: Array<{ aspect: RatingAspect; score: number; comment: string | null }>;
} {
  const comment = (dto?.comment ?? '').toString().trim().slice(0, 2000) || null;
  const given = Array.isArray(dto?.ratings) ? dto.ratings : [];
  const ratings = RATING_ASPECTS.map((aspect) => {
    const r = given.filter((g) => String(g?.aspect ?? '').toUpperCase() === aspect);
    if (r.length !== 1) throw new BadRequestException(`Rate ${aspect.toLowerCase()} (1–5)`);
    const score = Number(r[0].score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new BadRequestException(`${aspect.toLowerCase()} must be a whole number from 1 to 5`);
    }
    const why = (r[0].comment ?? '').toString().trim().slice(0, 1000) || null;
    if (score < LOW_SCORE && (!why || why.length < 5)) {
      throw new BadRequestException(
        `${aspect.toLowerCase()} below ${LOW_SCORE} needs a comment saying what was wrong`,
      );
    }
    return { aspect, score, comment: why };
  });
  return { comment, ratings };
}

/**
 * Why an agent is, or is not, a fit for one arrival.
 *
 *   AVAILABLE         a declared block covers the arrival time
 *   TIME_UNCONFIRMED  the arrival time is our 15:00 guess and the agent has
 *                     declared something that day; we cannot say more yet
 *   OUTSIDE_HOURS     declared that day, but not around the arrival time
 *   NOT_DECLARED      nothing declared for that day
 *   TIME_OFF          the agent (or the desk) marked the day off
 */
export type AgentFit = 'AVAILABLE' | 'TIME_UNCONFIRMED' | 'OUTSIDE_HOURS' | 'NOT_DECLARED' | 'TIME_OFF';

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
  timeOff = false,
): AgentFit {
  if (timeOff) return 'TIME_OFF';
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
  TIME_OFF: 4,
};

export interface AgentOption {
  id: string;
  name: string;
  fit: AgentFit;
  eligible: boolean;
  /** "HH:mm–HH:mm" blocks the agent declared for the arrival day, for the dropdown hint. */
  declared: string[];
  /** VACATION | SICK | OTHER when fit is TIME_OFF. */
  timeOffReason: string | null;
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
    const off = await this.prisma.agentTimeOff.findMany({
      where: { tenantId, day, userId: { in: agents.map((a) => a.id) } },
      select: { userId: true, reason: true },
    });
    const offBy = new Map<string, string>(
      off.map((o: { userId: string; reason: unknown }) => [o.userId, String(o.reason)] as [string, string]),
    );

    const options: AgentOption[] = agents
      .map((a) => {
        const mine = blocks.filter((b) => b.userId === a.id);
        const fit = classifyAgent(mine, day, arrivalMinute, assumed, offBy.has(a.id));
        return {
          id: a.id,
          name: a.name,
          fit,
          eligible: ELIGIBLE_FITS.includes(fit),
          declared: mine
            .filter((b) => b.day === day)
            .map((b) => `${hhmm(b.startMinute)}–${hhmm(b.endMinute)}`),
          timeOffReason: offBy.get(a.id) ?? null,
        };
      })
      .sort((x, y) => FIT_ORDER[x.fit] - FIT_ORDER[y.fit] || x.name.localeCompare(y.name, 'cs'));

    return {
      bookingId,
      day,
      arrival: hhmm(arrivalMinute),
      arrivalAssumed: assumed,
      /** Hours for this day were due by 18:00 two days before; "nothing declared" is now late, not pending. */
      deadlinePassed: isLocked(day),
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
      const off = await this.prisma.agentTimeOff.findFirst({
        where: { tenantId, userId: agentId, day },
        select: { id: true },
      });
      fit = classifyAgent(blocks, day, arrivalMinute, assumed, !!off);
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
    const from = startOfDayInAppZone(addDays(todayInAppZone(), -MINE_LOOKBACK_DAYS));
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
          checkInReport: { select: { id: true } },
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
        reported: !!(b as any).checkInReport,
      })),
      pending,
    };
  }

  /**
   * One check-in, for the agent assigned to it: what they need at the door —
   * the guest's name and phone, the time and the registration link — and
   * their report if they wrote one.
   */
  async detail(tenantId: string, userId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId, checkInAgentId: userId, status: BookingStatus.CONFIRMED },
      select: {
        id: true, bookingRef: true, accommodationName: true, checkInTime: true, checkInSource: true,
        numAdults: true, numChildren: true, checkInAgentConsent: true, checkInLinkUrl: true,
        pmsRawData: true, needsCrib: true, separateBeds: true,
        // The desk may have typed a better number in Planning (Oct 2026).
        guestPhone: true,
        checkInReport: { include: { ratings: true } },
      } as any,
    }) as any;
    if (!b) throw new NotFoundException('This check-in is not assigned to you');
    const day = todayInAppZone(b.checkInTime);
    return {
      id: b.id,
      bookingRef: b.bookingRef,
      accommodationName: b.accommodationName,
      day,
      time: timeInAppZone(b.checkInTime),
      arrivalAssumed: b.checkInSource === 'FALLBACK',
      numAdults: b.numAdults,
      numChildren: b.numChildren,
      needsCrib: b.needsCrib,
      separateBeds: b.separateBeds,
      guestName: guestNameFromRaw(b.pmsRawData) ?? null,
      guestPhone: (b as any).guestPhone ?? guestPhoneFromRaw(b.pmsRawData),
      checkInLinkUrl: b.checkInLinkUrl ?? null,
      awaitingMyAnswer: b.checkInAgentConsent === ('PENDING' as any),
      canReport: this.reportOpen(day),
      aspects: RATING_ASPECTS,
      lowScore: LOW_SCORE,
      report: b.checkInReport ? this.shapeReport(b.checkInReport) : null,
    };
  }

  /** Write or correct the report. Only the assigned agent, from arrival day for two weeks. */
  async saveReport(tenantId: string, userId: string, bookingId: string, dto: ReportDto) {
    const b = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId, checkInAgentId: userId, status: BookingStatus.CONFIRMED },
      select: {
        id: true, bookingRef: true, accommodationName: true, checkInTime: true, checkInAgentConsent: true,
        checkInReport: { select: { id: true } },
        turnoversAsTo: {
          where: { supersededById: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, assignments: { select: { userId: true, status: true } } },
        },
      },
    });
    if (!b) throw new NotFoundException('This check-in is not assigned to you');
    if (b.checkInAgentConsent === ('PENDING' as any)) {
      throw new ConflictException('Accept the check-in first');
    }
    const day = todayInAppZone(b.checkInTime);
    if (!this.reportOpen(day)) {
      throw new BadRequestException(
        day > todayInAppZone() ? 'You can write the report on the arrival day' : 'This check-in is too old to report on',
      );
    }
    const { comment, ratings } = validateReport(dto);
    const turnover = (b as any).turnoversAsTo?.[0] ?? null;
    const cleanerIds: string[] = turnover
      ? [...new Set<string>(
          turnover.assignments
            .filter((a: any) => ['ASSIGNED', 'STARTED', 'COMPLETED'].includes(String(a.status)))
            .map((a: any) => a.userId as string),
        )]
      : [];
    const existed = !!(b as any).checkInReport;

    const saved = await this.prisma.$transaction(async (tx) => {
      const report = await tx.checkInReport.upsert({
        where: { bookingId: b.id },
        create: { tenantId, bookingId: b.id, agentId: userId, comment, turnoverId: turnover?.id ?? null, cleanerIds },
        update: { agentId: userId, comment, turnoverId: turnover?.id ?? null, cleanerIds },
      });
      await tx.checkInRating.deleteMany({ where: { reportId: report.id } });
      await tx.checkInRating.createMany({
        data: ratings.map((r) => ({ reportId: report.id, aspect: r.aspect, score: r.score, comment: r.comment })),
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          category: AuditCategory.ASSIGNMENT_LIFECYCLE,
          action: existed ? 'checkin.report_updated' : 'checkin.report_submitted',
          actorId: userId,
          targetType: 'Booking',
          targetId: b.id,
          metadata: {
            bookingRef: b.bookingRef,
            accommodationName: b.accommodationName,
            scores: Object.fromEntries(ratings.map((r) => [r.aspect, r.score])),
            low: ratings.filter((r) => r.score < LOW_SCORE).map((r) => r.aspect),
            turnoverId: turnover?.id ?? null,
            cleanerIds,
          } as any,
        },
      });
      return tx.checkInReport.findUniqueOrThrow({ where: { id: report.id }, include: { ratings: true } });
    });

    this.nudge(tenantId, b.id, []);
    return this.shapeReport(saved);
  }

  /** The desk reads a report (Planning modal). */
  async reportForDesk(tenantId: string, bookingId: string) {
    const r = await this.prisma.checkInReport.findFirst({
      where: { tenantId, bookingId },
      include: { ratings: true },
    });
    if (!r) return null;
    const [agent, cleaners] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: r.agentId, tenantId }, select: { name: true } }),
      r.cleanerIds.length
        ? this.prisma.user.findMany({ where: { id: { in: r.cleanerIds }, tenantId }, select: { name: true } })
        : Promise.resolve([] as Array<{ name: string }>),
    ]);
    return {
      ...this.shapeReport(r),
      agentName: agent?.name ?? null,
      cleanerNames: cleaners.map((c) => c.name),
    };
  }

  private reportOpen(arrivalDay: string): boolean {
    const today = todayInAppZone();
    return arrivalDay <= today && arrivalDay >= addDays(today, -REPORT_WINDOW_DAYS);
  }

  private shapeReport(r: {
    comment: string | null; submittedAt: Date; updatedAt: Date;
    ratings: Array<{ aspect: string; score: number; comment: string | null }>;
  }) {
    return {
      comment: r.comment,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
      ratings: r.ratings.map((x) => ({ aspect: x.aspect, score: x.score, comment: x.comment })),
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

  /**
   * The split "Assigned" view: chosen agents' check-ins over [from, to]
   * (Prague days, ≤ 7), ordered by time and grouped by day, each with the leg
   * from the previous one and a day footer. Without `agentIds`, every agent
   * who has something in the range.
   */
  async route(tenantId: string, from: string, to: string, agentIds?: string[], area: string | null = null) {
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (!DAY.test(from) || !DAY.test(to) || to < from) throw new BadRequestException('from/to must be YYYY-MM-DD');
    if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > 7) {
      throw new BadRequestException('At most 7 days at once');
    }
    const range = { gte: startOfDayInAppZone(from), lt: startOfDayInAppZone(addDays(to, 1)) };

    const [agents, bookings, unassigned] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, role: 'AGENT' as any, isActive: true },
        select: { id: true, name: true, mobileNumber: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId, status: BookingStatus.CONFIRMED, isOwnerStay: false, checkInTime: range,
          checkInAgentId: agentIds?.length ? { in: agentIds } : { not: null },
          ...propertyInArea(area),
        },
        orderBy: { checkInTime: 'asc' },
        select: {
          id: true, bookingRef: true, accommodationName: true, checkInTime: true, checkInSource: true,
          checkInAgentId: true, checkInAgentConsent: true, numAdults: true, numChildren: true,
          property: { select: { pmsPropertyId: true } },
        },
      }),
      this.prisma.booking.count({
        where: { tenantId, status: BookingStatus.CONFIRMED, isOwnerStay: false, checkInTime: range, checkInAgentId: null, ...propertyInArea(area) },
      }),
    ]);

    const acks = await this.ackStateFor(tenantId, bookings.map((b: any) => b.id));

    const byAgent = new Map<string, any[]>();
    for (const b of bookings as any[]) {
      byAgent.set(b.checkInAgentId, [...(byAgent.get(b.checkInAgentId) ?? []), b]);
    }
    const wanted = agentIds?.length ? agentIds : [...byAgent.keys()];

    return {
      from,
      to,
      unassignedCount: unassigned,
      agents: agents.map((a) => ({ id: a.id, name: a.name, count: byAgent.get(a.id)?.length ?? 0 })),
      columns: wanted
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is { id: string; name: string; mobileNumber: string | null } => !!a)
        .map((a) => {
          const mine = byAgent.get(a.id) ?? [];
          const days = new Map<string, any[]>();
          for (const b of mine) {
            const d = todayInAppZone(b.checkInTime);
            days.set(d, [...(days.get(d) ?? []), b]);
          }
          return {
            agentId: a.id,
            name: a.name,
            mobileNumber: a.mobileNumber,
            days: [...days.entries()].map(([day, list]) => {
              const items = list.map((b) => {
                const ack = acks.get(b.id);
                return {
                  bookingId: b.id,
                  bookingRef: b.bookingRef,
                  accommodationName: b.accommodationName,
                  time: timeInAppZone(b.checkInTime),
                  arrivalAssumed: b.checkInSource === 'FALLBACK',
                  guests: `${b.numAdults}${b.numChildren ? `+${b.numChildren}` : ''}`,
                  consent: b.checkInAgentConsent,
                  seen: ack ? (ack.userId === a.id ? !!ack.ackedAt : true) : true,
                };
              });
              return {
                day,
                items,
                footer: {
                  count: items.length,
                  first: items[0]?.time ?? null,
                  last: items[items.length - 1]?.time ?? null,
                },
              };
            }),
          };
        }),
    };
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
