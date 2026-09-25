import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import {
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
    const rows = await this.prisma.agentAvailability.findMany({
      where: { tenantId, userId, day: { gte: lo, lte: hi } },
      orderBy: [{ day: 'asc' }, { startMinute: 'asc' }],
    });
    return { today, horizon: addDays(today, HORIZON_DAYS - 1), blocks: rows.map(toBlock) };
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
    let copied = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const b of source) {
        const target = addDays(b.day, 7);
        if (target < today || target > last) continue;
        await this.mergeInto(tx, tenantId, userId, target, b.startMinute, b.endMinute, null);
        copied++;
      }
    });
    return { copied, ...(await this.listMine(tenantId, userId)) };
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
  async board(tenantId: string, from: string, to: string) {
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
        },
        select: {
          id: true, bookingRef: true, accommodationName: true, checkInTime: true, checkInSource: true,
        },
        orderBy: { checkInTime: 'asc' },
      }),
    ]);

    const agentIds = new Set(agents.map((a: { id: string }) => a.id));
    return {
      from,
      to,
      today: todayInAppZone(),
      agents,
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

  /** Today and the past are fixed: the desk has already planned around them. */
  private assertEditable(day: string): void {
    const today = todayInAppZone();
    if (day < today) throw new ForbiddenException('This day is over');
    if (day === today) {
      throw new ForbiddenException("Today's availability can't be changed or removed — call the front desk");
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
