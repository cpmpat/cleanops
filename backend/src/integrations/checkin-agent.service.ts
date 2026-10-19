import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditCategory, BookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { timeInAppZone, todayInAppZone } from '../common/time';
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

@Injectable()
export class CheckInAgentService {
  constructor(private prisma: PrismaService) {}

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
   * The change and its audit row are one transaction.
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.booking.update({
        where: { id: booking.id },
        data: {
          checkInAgentId: agentId,
          checkInAgentAssignedById: agentId ? actorId : null,
          checkInAgentAssignedAt: agentId ? now : null,
          checkInAgentOverride: override,
        },
        select: {
          id: true, bookingRef: true, accommodationName: true, checkInTime: true,
          checkInAgentId: true, checkInAgentAssignedAt: true, checkInAgentOverride: true,
        },
      });

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
          // Never the check-in link: it is a bearer token to guest registration.
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
          } as any,
        },
      });
      return row;
    });

    return this.shape(updated, agent?.name ?? null);
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async loadBooking(tenantId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      select: {
        id: true, bookingRef: true, status: true, accommodationName: true,
        checkInTime: true, checkInSource: true,
        checkInAgentId: true, checkInAgentAssignedAt: true, checkInAgentOverride: true,
        checkInAgent: { select: { id: true, name: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
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
