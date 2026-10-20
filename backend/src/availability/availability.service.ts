import { areaOf, propertyInArea } from '../common/area';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditCategory, BookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import {
  atTimeInAppZone,
  startOfDayInAppZone,
  timeInAppZone,
  todayInAppZone,
} from '../common/time';

/** Minutes are counted in steps of this size; the agent's −/+ buttons move by it. */
export const STEP_MINUTES = 30;
/** A block may run past midnight up to 06:00 next morning. */
export const MAX_END_MINUTE = 1440 + 6 * 60;
/** How far ahead an agent may declare. */
export const HORIZON_DAYS = 28;
/** Widest window the desk board reads in one call. */
const MAX_BOARD_DAYS = 14;
/** Hours for day D are due by this time on D minus DEADLINE_DAYS_BEFORE (Prague). */
export const DEADLINE_TIME = '18:00';
export const DEADLINE_DAYS_BEFORE = 2;
/** Time off may be recorded this far ahead (vacations are planned early). */
const TIME_OFF_HORIZON_DAYS = 120;
/** Longest single time-off range. */
const MAX_TIME_OFF_SPAN = 60;

export const TIME_OFF_REASONS = ['VACATION', 'SICK', 'OTHER'] as const;
export type TimeOffReasonValue = (typeof TIME_OFF_REASONS)[number];

/**
 * The instant hours for `day` are due: 18:00 Prague two days before. A
 * Wednesday arrival is planned from Monday 18:00 on, so the agent's
 * Wednesday must be in by then.
 */
export function deadlineFor(day: string): Date {
  return atTimeInAppZone(addDays(day, -DEADLINE_DAYS_BEFORE), DEADLINE_TIME);
}

/** Past the deadline: hours can still be added, not changed or removed. */
export function isLocked(day: string, now: Date = new Date()): boolean {
  return now.getTime() >= deadlineFor(day).getTime();
}

/** The last day already past its deadline. Every day up to it is locked. */
export function lockedThrough(now: Date = new Date()): string {
  const today = todayInAppZone(now);
  const inTwo = addDays(today, DEADLINE_DAYS_BEFORE);
  return isLocked(inTwo, now) ? inTwo : addDays(inTwo, -1);
}

export interface TimeOffDto {
  from: string;
  to: string;
  reason: string;
  note?: string;
}

export interface TimeOffDay {
  userId: string;
  day: string;
  reason: TimeOffReasonValue;
  note: string | null;
  via: string;
  setById: string;
}

export interface AvailabilityBlock {
  id: string;
  userId: string;
  day: string;
  startMinute: number;
  endMinute: number;
  /** "HH:mm" of start and end in Prague; end past midnight reads as the clock does ("01:00"). */
  start: string;
  end: string;
  updatedAt: Date;
}

export interface CreateAvailabilityDto {
  /** YYYY-MM-DD (Prague). The same hours are saved on each. */
  days: string[];
  /** "HH:mm". */
  start: string;
  /** "HH:mm". Earlier than or equal to `start` means past midnight. */
  end: string;
}

export interface UpdateAvailabilityDto {
  start: string;
  end: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Days since the epoch for a YYYY-MM-DD — calendar arithmetic without time zones. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function assertDay(day: string): void {
  if (!DAY_RE.test(day) || Number.isNaN(dayNumber(day))) {
    throw new BadRequestException(`Not a date: "${day}" (expected YYYY-MM-DD)`);
  }
}

function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * "18:00"–"23:00" → [1080, 1380]; "21:00"–"01:00" → [1260, 1500].
 * An end at or before the start is read as the next morning — that is how
 * people say it ("from nine till one"), and a zero-length block means nothing.
 */
export function resolveRange(start: string, end: string): { startMinute: number; endMinute: number } {
  const s = TIME_RE.exec(start ?? '');
  const e = TIME_RE.exec(end ?? '');
  if (!s || !e) throw new BadRequestException('Times must be HH:mm');
  const startMinute = Number(s[1]) * 60 + Number(s[2]);
  let endMinute = Number(e[1]) * 60 + Number(e[2]);
  if (endMinute <= startMinute) endMinute += 1440;
  if (startMinute % STEP_MINUTES || endMinute % STEP_MINUTES) {
    throw new BadRequestException(`Times go in ${STEP_MINUTES}-minute steps`);
  }
  if (endMinute > MAX_END_MINUTE) {
    throw new BadRequestException('A block past midnight must end by 06:00');
  }
  return { startMinute, endMinute };
}

function toBlock(r: {
  id: string; userId: string; day: string; startMinute: number; endMinute: number; updatedAt: Date;
}): AvailabilityBlock {
  return {
    id: r.id,
    userId: r.userId,
    day: r.day,
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    start: hhmm(r.startMinute),
    end: hhmm(r.endMinute),
    updatedAt: r.updatedAt,
  };
}

function toTimeOff(r: {
  userId: string; day: string; reason: any; note: string | null; via: string; setById: string;
}): TimeOffDay {
  return { userId: r.userId, day: r.day, reason: r.reason, note: r.note, via: r.via, setById: r.setById };
}

/** YYYY-MM-DD days from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  // ─── Agent: own blocks ─────────────────────────────────────────────────────

  async listMine(tenantId: string, userId: string, from?: string, to?: string) {
    const today = todayInAppZone();
    const lo = from ?? today;
    const hi = to ?? addDays(today, HORIZON_DAYS);
    assertDay(lo);
    assertDay(hi);
    const [rows, off] = await Promise.all([
      this.prisma.agentAvailability.findMany({
        where: { tenantId, userId, day: { gte: lo, lte: hi } },
        orderBy: [{ day: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.agentTimeOff.findMany({
        where: { tenantId, userId, day: { gte: lo, lte: addDays(today, TIME_OFF_HORIZON_DAYS) } },
        orderBy: { day: 'asc' },
      }),
    ]);
    return {
      today,
      horizon: addDays(today, HORIZON_DAYS - 1),
      lockedThrough: lockedThrough(),
      deadline: { time: DEADLINE_TIME, daysBefore: DEADLINE_DAYS_BEFORE },
      blocks: rows.map(toBlock),
      timeOff: off.map(toTimeOff),
    };
  }

  /**
   * Save the same hours on one or more days. A block that touches or overlaps
   * one of the agent's blocks on the same day is merged into it — adding
   * "18:00–23:00" to a day that has "20:00–01:00" leaves one "18:00–01:00" —
   * because the question the desk asks is "is she available at 22:00", not
   * "how many times did she tap Save".
   *
   * Adding to today is allowed (more availability only helps the desk);
   * merging never shrinks a block, so today's rule — nothing removed — holds.
   */
  async createMine(tenantId: string, userId: string, dto: CreateAvailabilityDto) {
    const days = Array.from(new Set(dto?.days ?? []));
    if (days.length === 0) throw new BadRequestException('Pick at least one day');
    if (days.length > 14) throw new BadRequestException('At most 14 days at once');
    days.forEach(assertDay);
    const { startMinute, endMinute } = resolveRange(dto.start, dto.end);

    const today = todayInAppZone();
    const last = addDays(today, HORIZON_DAYS - 1);
    for (const day of days) {
      if (day < today) throw new BadRequestException(`${day} is in the past`);
      if (day > last) throw new BadRequestException(`You can plan up to ${HORIZON_DAYS} days ahead`);
    }
    const off = await this.prisma.agentTimeOff.findMany({
      where: { tenantId, userId, day: { in: days } },
      select: { day: true },
    });
    if (off.length) {
      throw new BadRequestException(
        `You marked ${off.map((o) => o.day).sort().join(', ')} as time off — remove the time off first`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const day of days.sort()) {
        await this.mergeInto(tx, tenantId, userId, day, startMinute, endMinute, null);
      }
    });
    return this.listMine(tenantId, userId);
  }

  /** Change one block. Only from tomorrow on — today's hours are fixed once declared. */
  async updateMine(tenantId: string, userId: string, id: string, dto: UpdateAvailabilityDto) {
    const block = await this.ownBlock(tenantId, userId, id);
    this.assertEditable(block.day);
    const { startMinute, endMinute } = resolveRange(dto.start, dto.end);
    await this.prisma.$transaction(async (tx) => {
      await this.mergeInto(tx, tenantId, userId, block.day, startMinute, endMinute, block.id);
    });
    return this.listMine(tenantId, userId);
  }

  /** Remove one block. Only from tomorrow on. */
  async deleteMine(tenantId: string, userId: string, id: string) {
    const block = await this.ownBlock(tenantId, userId, id);
    this.assertEditable(block.day);
    await this.prisma.agentAvailability.delete({ where: { id: block.id } });
    return this.listMine(tenantId, userId);
  }

  /**
   * Copy the week starting `weekStart` (a Monday) onto the week after it.
   * Merges like createMine; days of the target week that are already past
   * are skipped. Returns how many blocks were copied.
   */
  async copyWeek(tenantId: string, userId: string, weekStart: string) {
    assertDay(weekStart);
    const [y, m, d] = weekStart.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 1) {
      throw new BadRequestException('weekStart must be a Monday');
    }
    const today = todayInAppZone();
    const last = addDays(today, HORIZON_DAYS - 1);
    const source = await this.prisma.agentAvailability.findMany({
      where: { tenantId, userId, day: { gte: weekStart, lte: addDays(weekStart, 6) } },
      orderBy: [{ day: 'asc' }, { startMinute: 'asc' }],
    });
    const offDays = new Set(
      (await this.prisma.agentTimeOff.findMany({
        where: { tenantId, userId, day: { gte: addDays(weekStart, 7), lte: addDays(weekStart, 13) } },
        select: { day: true },
      })).map((o) => o.day),
    );
    let copied = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const b of source) {
        const target = addDays(b.day, 7);
        if (target < today || target > last) continue;
        if (offDays.has(target)) continue;
        await this.mergeInto(tx, tenantId, userId, target, b.startMinute, b.endMinute, null);
        copied++;
      }
    });
    return { copied, ...(await this.listMine(tenantId, userId)) };
  }

  // ─── Time off (agent for themself, or the desk after a phone call) ────────

  /**
   * Mark `from..to` as time off. Hours already declared on those days are
   * removed — time off wins, even past the deadline, because being ill does
   * not wait for 18:00. Refused while the agent still holds check-ins on any
   * of those days: the desk reassigns them first, so nobody is left without
   * an agent by a tap on a phone.
   */
  async setTimeOff(
    tenantId: string,
    agentId: string,
    actor: { id: string; via: 'APP' | 'DESK' },
    dto: TimeOffDto,
  ) {
    const { days, reason } = this.validateTimeOff(dto, true);
    const note = (dto.note ?? '').trim().slice(0, 300) || null;
    const agent = await this.activeAgent(tenantId, agentId);

    const held = await this.prisma.booking.findMany({
      where: {
        tenantId,
        checkInAgentId: agentId,
        status: BookingStatus.CONFIRMED,
        checkInTime: {
          gte: startOfDayInAppZone(days[0]),
          lt: startOfDayInAppZone(addDays(days[days.length - 1], 1)),
        },
      },
      select: { bookingRef: true, accommodationName: true, checkInTime: true },
      orderBy: { checkInTime: 'asc' },
    });
    if (held.length) {
      const list = held
        .slice(0, 3)
        .map((b) => `${b.accommodationName} ${todayInAppZone(b.checkInTime)} ${timeInAppZone(b.checkInTime)}`)
        .join('; ');
      const who = actor.via === 'APP' ? 'You have' : `${agent.name} has`;
      throw new ConflictException({
        code: 'HOLDS_CHECKINS',
        count: held.length,
        message:
          `${who} ${held.length} check-in${held.length === 1 ? '' : 's'} on these days (${list}` +
          `${held.length > 3 ? '; …' : ''}). ` +
          (actor.via === 'APP' ? 'Call the front desk to reassign them first.' : 'Reassign them first.'),
      });
    }

    let removedBlocks = 0;
    await this.prisma.$transaction(async (tx) => {
      const del = await tx.agentAvailability.deleteMany({
        where: { tenantId, userId: agentId, day: { in: days } },
      });
      removedBlocks = del.count;
      for (const day of days) {
        await tx.agentTimeOff.upsert({
          where: { userId_day: { userId: agentId, day } },
          create: { tenantId, userId: agentId, day, reason: reason as any, note, setById: actor.id, via: actor.via },
          update: { reason: reason as any, note, setById: actor.id, via: actor.via },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          category: 'AVAILABILITY_LIFECYCLE' as AuditCategory,
          action: 'availability.time_off_set',
          actorId: actor.id,
          targetType: 'User',
          targetId: agentId,
          metadata: {
            agentId,
            agentName: agent.name,
            from: days[0],
            to: days[days.length - 1],
            days: days.length,
            reason,
            via: actor.via,
            removedBlocks,
          } as any,
        },
      });
    });
    return { ok: true, days: days.length, removedBlocks };
  }

  /** Remove time off on `from..to` (today onwards). The days go back to "nothing declared". */
  async removeTimeOff(
    tenantId: string,
    agentId: string,
    actor: { id: string; via: 'APP' | 'DESK' },
    dto: { from: string; to?: string },
  ) {
    const { days } = this.validateTimeOff({ from: dto.from, to: dto.to ?? dto.from, reason: 'OTHER' }, false);
    const agent = await this.activeAgent(tenantId, agentId);
    let removed = 0;
    await this.prisma.$transaction(async (tx) => {
      const del = await tx.agentTimeOff.deleteMany({
        where: { tenantId, userId: agentId, day: { in: days } },
      });
      removed = del.count;
      if (!removed) return;
      await tx.auditEvent.create({
        data: {
          tenantId,
          category: 'AVAILABILITY_LIFECYCLE' as AuditCategory,
          action: 'availability.time_off_removed',
          actorId: actor.id,
          targetType: 'User',
          targetId: agentId,
          metadata: {
            agentId,
            agentName: agent.name,
            from: days[0],
            to: days[days.length - 1],
            days: removed,
            via: actor.via,
          } as any,
        },
      });
    });
    return { ok: true, removed };
  }

  private validateTimeOff(dto: TimeOffDto, needReason: boolean) {
    assertDay(dto?.from);
    assertDay(dto?.to);
    if (dto.to < dto.from) throw new BadRequestException('The end is before the start');
    const today = todayInAppZone();
    if (dto.from < today) throw new BadRequestException('Time off cannot start in the past');
    if (dto.to > addDays(today, TIME_OFF_HORIZON_DAYS)) {
      throw new BadRequestException(`Time off can be set up to ${TIME_OFF_HORIZON_DAYS} days ahead`);
    }
    const days = daysBetween(dto.from, dto.to);
    if (days.length > MAX_TIME_OFF_SPAN) {
      throw new BadRequestException(`At most ${MAX_TIME_OFF_SPAN} days at once`);
    }
    const reason = String(dto.reason ?? '').toUpperCase();
    if (needReason && !(TIME_OFF_REASONS as readonly string[]).includes(reason)) {
      throw new BadRequestException(`Reason must be one of ${TIME_OFF_REASONS.join(', ')}`);
    }
    return { days, reason };
  }

  private async activeAgent(tenantId: string, userId: string) {
    const agent = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, role: 'AGENT' as any, isActive: true },
      select: { id: true, name: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  // ─── Desk: board ───────────────────────────────────────────────────────────

  /**
   * Everything Planning → Agents draws for [from, to] (inclusive, Prague days):
   * the active agents, their blocks, and the arrivals in the window so the
   * page can set supply against demand hour by hour.
   *
   * Arrivals are CONFIRMED bookings (every live Avantio status — CONFIRMED,
   * UNPAID, OWNER — is stored as CONFIRMED here). `assumed` marks arrivals
   * whose time is our 15:00 default, so the page can show them apart instead
   * of piling them all onto the 15:00 hour as if they were real.
   */
  async board(tenantId: string, from: string, to: string, viewerId?: string) {
    const area = await areaOf(this.prisma, tenantId, viewerId);
    assertDay(from);
    assertDay(to);
    if (to < from) throw new BadRequestException('to is before from');
    if (dayNumber(to) - dayNumber(from) + 1 > MAX_BOARD_DAYS) {
      throw new BadRequestException(`At most ${MAX_BOARD_DAYS} days at once`);
    }

    const [agents, rows, bookings] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, role: 'AGENT' as any, isActive: true },
        select: { id: true, name: true, mobileNumber: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.agentAvailability.findMany({
        where: { tenantId, day: { gte: from, lte: to } },
        orderBy: [{ day: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId,
          status: BookingStatus.CONFIRMED,
          checkInTime: {
            gte: startOfDayInAppZone(from),
            lt: startOfDayInAppZone(addDays(to, 1)),
          },
          ...propertyInArea(area),
        },
        select: {
          id: true, bookingRef: true, accommodationName: true, checkInTime: true, checkInSource: true,
        },
        orderBy: { checkInTime: 'asc' },
      }),
    ]);

    const agentIds = new Set(agents.map((a: { id: string }) => a.id));
    const off = await this.prisma.agentTimeOff.findMany({
      where: { tenantId, day: { gte: from, lte: to }, userId: { in: [...agentIds] } },
      orderBy: { day: 'asc' },
    });
    return {
      from,
      to,
      today: todayInAppZone(),
      /** Every day up to this one is past its deadline; "nothing declared" there is late, not pending. */
      lockedThrough: lockedThrough(),
      agents,
      timeOff: off.map(toTimeOff),
      // A block of someone who is no longer an active agent is not supply.
      blocks: rows.filter((r: { userId: string }) => agentIds.has(r.userId)).map((r: any) => toBlock(r)),
      arrivals: bookings.map((b: any) => {
        const time = timeInAppZone(b.checkInTime);
        return {
          id: b.id,
          bookingRef: b.bookingRef,
          accommodationName: b.accommodationName,
          day: todayInAppZone(b.checkInTime),
          time,
          minute: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)),
          assumed: (b as any).checkInSource === 'FALLBACK',
        };
      }),
    };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async ownBlock(tenantId: string, userId: string, id: string) {
    const block = await this.prisma.agentAvailability.findFirst({ where: { id, tenantId, userId } });
    if (!block) throw new NotFoundException('Availability block not found');
    return block;
  }

  /**
   * Past the deadline (18:00 two days before) the desk is planning around
   * these hours: they can be added to, not changed or removed.
   */
  private assertEditable(day: string): void {
    const today = todayInAppZone();
    if (day < today) throw new ForbiddenException('This day is over');
    if (day === today) {
      throw new ForbiddenException("Today's availability can't be changed or removed — call the front desk");
    }
    if (isLocked(day)) {
      throw new ForbiddenException(
        `Hours for ${day} are fixed since ${addDays(day, -DEADLINE_DAYS_BEFORE)} ${DEADLINE_TIME}. ` +
        'You can still add hours; to change or remove them, call the front desk.',
      );
    }
  }

  /**
   * Write [start, end) on `day` for this agent, merged with any of their
   * blocks on the same day it touches. `replacingId` is the block being edited
   * (it is dropped and re-merged). A clash with a block on the day before or
   * after — only possible around midnight — is refused rather than merged,
   * because the merged block would have to change day.
   */
  private async mergeInto(
    tx: any,
    tenantId: string,
    userId: string,
    day: string,
    startMinute: number,
    endMinute: number,
    replacingId: string | null,
  ): Promise<void> {
    const neighbours = await tx.agentAvailability.findMany({
      where: {
        tenantId,
        userId,
        day: { gte: addDays(day, -1), lte: addDays(day, 1) },
        ...(replacingId ? { id: { not: replacingId } } : {}),
      },
    });
    const base = dayNumber(day) * 1440;
    let lo = base + startMinute;
    let hi = base + endMinute;

    const sameDay = neighbours.filter((n: any) => n.day === day);
    const otherDays = neighbours.filter((n: any) => n.day !== day);

    for (const n of otherDays) {
      const nlo = dayNumber(n.day) * 1440 + n.startMinute;
      const nhi = dayNumber(n.day) * 1440 + n.endMinute;
      if (nlo < hi && lo < nhi) {
        throw new BadRequestException(
          `Overlaps your ${hhmm(n.startMinute)}–${hhmm(n.endMinute)} on ${n.day}`,
        );
      }
    }

    // Touching counts: 18:00–20:00 and 20:00–23:00 are one evening.
    const absorbed = sameDay.filter((n: any) => {
      const nlo = base + n.startMinute;
      const nhi = base + n.endMinute;
      return nlo <= hi && lo <= nhi;
    });
    for (const n of absorbed) {
      lo = Math.min(lo, base + n.startMinute);
      hi = Math.max(hi, base + n.endMinute);
    }
    if (hi - base > MAX_END_MINUTE) {
      throw new BadRequestException('A block past midnight must end by 06:00');
    }

    const drop = absorbed.map((n: any) => n.id);
    if (replacingId) drop.push(replacingId);
    if (drop.length) await tx.agentAvailability.deleteMany({ where: { id: { in: drop } } });
    await tx.agentAvailability.create({
      data: { tenantId, userId, day, startMinute: lo - base, endMinute: hi - base },
    });
  }
}
