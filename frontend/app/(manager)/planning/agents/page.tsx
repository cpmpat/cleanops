'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '@/lib/locale-context';
import {
  availability as availabilityApi,
  type AvailabilityBoard,
  type AvailabilityBlock,
  type AvailabilityBoardArrival,
} from '@/lib/api';
import {
  useAvailabilityStrings, addDays, mondayOf, dayParts, hhmm, formatDuration,
  type AvailabilityStrings,
} from '@/i18n/availability';
import type { Locale } from '@/i18n/translations';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronLeft, ChevronRight, Phone } from 'lucide-react';

/** The timeline runs 08:00 → 02:00 next morning: when guests arrive and agents work. */
const WINDOW_START = 8 * 60;
const WINDOW_END = 26 * 60;
const WINDOW = WINDOW_END - WINDOW_START;
const HOURS = Array.from({ length: WINDOW / 60 }, (_, i) => WINDOW_START + i * 60);
/** More arrivals than this per available agent in one hour is flagged amber. */
const STRAIN_RATIO = 4;

const pragueToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
const pragueNowMinute = () => {
  const [h, m] = new Date()
    .toLocaleTimeString('sv-SE', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .split(':').map(Number);
  return h * 60 + m;
};
const pct = (minute: number) => `${((minute - WINDOW_START) / WINDOW) * 100}%`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
/** 480 → "08", 1500 → "01" */
const hourLabel = (minute: number) => hhmm(minute).slice(0, 2);

interface HourCell {
  minute: number;
  arrivals: number;
  assumed: number;
  agents: number;
  gap: boolean;
  strain: boolean;
}

/** Supply against demand for one day, hour by hour across the window. */
function coverage(day: string, blocks: AvailabilityBlock[], arrivals: AvailabilityBoardArrival[]): HourCell[] {
  const dayBlocks = blocks.filter(b => b.day === day);
  const dayArrivals = arrivals.filter(a => a.day === day);
  return HOURS.map(minute => {
    const inHour = dayArrivals.filter(a => a.minute >= minute && a.minute < minute + 60);
    const agentIds = new Set(
      dayBlocks.filter(b => b.startMinute < minute + 60 && b.endMinute > minute).map(b => b.userId),
    );
    const arrivalsN = inHour.length;
    const agentsN = agentIds.size;
    return {
      minute,
      arrivals: arrivalsN,
      assumed: inHour.filter(a => a.assumed).length,
      agents: agentsN,
      gap: arrivalsN > 0 && agentsN === 0,
      strain: agentsN > 0 && arrivalsN / agentsN > STRAIN_RATIO,
    };
  });
}

/** Consecutive flagged hours → "14–15", "15–17". */
function ranges(cells: HourCell[], flag: (c: HourCell) => boolean): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const c of cells) {
    if (!flag(c)) continue;
    const last = out[out.length - 1];
    if (last && last.to === c.minute) last.to = c.minute + 60;
    else out.push({ from: c.minute, to: c.minute + 60 });
  }
  return out;
}
const rangeText = (r: { from: number; to: number }) => `${hourLabel(r.from)}–${hourLabel(r.to)}`;

/**
 * Planning → Agents.
 *
 * Read-only for the desk: agents declare their own hours in their app. The
 * page sets that supply against arrivals from Check-In planning so a gap —
 * guests arriving with nobody to meet them — shows before it happens.
 */
export default function AgentsPlanningPage() {
  const { locale } = useLocale();
  const s = useAvailabilityStrings(locale as Locale);

  const [view, setView] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(pragueToday);
  const [board, setBoard] = useState<AvailabilityBoard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => {
    if (view === 'day') return { from: day, to: day };
    const monday = mondayOf(day);
    return { from: monday, to: addDays(monday, 6) };
  }, [view, day]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await availabilityApi.board(range.from, range.to));
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);
  // Agents change their hours from their phones; the desk tab stays open all
  // day. Re-read when the desk comes back to it.
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const today = board?.today ?? pragueToday();
  const step = view === 'day' ? 1 : 7;

  const label = view === 'day'
    ? `${day === today ? `${s.todayPrefix} · ` : ''}${dayParts(day, locale as Locale).short}`
    : `${dayParts(range.from, locale as Locale).short} – ${dayParts(range.to, locale as Locale).short}`;

  return (
    <div className="p-6 max-w-[1600px] tabular-nums">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">{s.deskTitle}</h1>
        <p className="text-sm text-ink-muted mt-0.5">{s.deskSubtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div role="group" className="flex bg-surface-sunken rounded-xl p-[3px]">
          {(['day', 'week'] as const).map(v => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'px-4 py-2 rounded-[9px] text-sm font-semibold transition',
                view === v ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {v === 'day' ? s.day : s.week}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={s.prev} onClick={() => setDay(d => addDays(d, -step))}
            className="w-9 h-9 rounded-xl border border-surface-border bg-white text-ink-soft flex items-center justify-center hover:text-ink">
            <ChevronLeft size={16} />
          </button>
          <span className="text-[15px] font-bold text-ink px-2.5 first-letter:uppercase min-w-[11rem] text-center">{label}</span>
          <button type="button" aria-label={s.next} onClick={() => setDay(d => addDays(d, step))}
            className="w-9 h-9 rounded-xl border border-surface-border bg-white text-ink-soft flex items-center justify-center hover:text-ink">
            <ChevronRight size={16} />
          </button>
        </div>
        {loading && <span className="text-xs text-ink-faint">…</span>}
      </div>

      {error && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      {board && board.agents.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border text-sm text-ink-muted">{s.noAgents}</div>
      )}

      {board && board.agents.length > 0 && (view === 'day'
        ? <DayView board={board} day={day} today={today} locale={locale as Locale} s={s} />
        : <WeekView board={board} today={today} locale={locale as Locale} s={s} onOpenDay={d => { setDay(d); setView('day'); }} />
      )}
    </div>
  );
}

// ─── Day ─────────────────────────────────────────────────────────────────────

function DayView({ board, day, today, locale, s }: {
  board: AvailabilityBoard; day: string; today: string; locale: Locale; s: AvailabilityStrings;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(pragueNowMinute);
  useEffect(() => {
    const id = setInterval(() => setNow(pragueNowMinute()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cells = useMemo(() => coverage(day, board.blocks, board.arrivals), [day, board]);
  const gaps = ranges(cells, c => c.gap);
  const strains = ranges(cells, c => c.strain);
  const dayArrivals = board.arrivals.filter(a => a.day === day);

  const rows = useMemo(() => {
    const byUser = new Map<string, AvailabilityBlock[]>();
    for (const b of board.blocks) {
      if (b.day !== day) continue;
      byUser.set(b.userId, [...(byUser.get(b.userId) ?? []), b]);
    }
    const on = board.agents
      .filter(a => byUser.has(a.id))
      .map(a => ({ agent: a, blocks: byUser.get(a.id)! }))
      .sort((x, y) => x.blocks[0].startMinute - y.blocks[0].startMinute || x.agent.name.localeCompare(y.agent.name));
    const off = board.agents.filter(a => !byUser.has(a.id));
    return { on, off };
  }, [board, day]);

  // Minutes since 08:00 on the displayed day; after midnight the clock reads 00:xx but the timeline continues.
  const nowInWindow = day === today ? now : day === addDays(today, -1) ? now + 1440 : null;
  const showNow = nowInWindow !== null && nowInWindow >= WINDOW_START && nowInWindow <= WINDOW_END;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-[12.5px] font-semibold">
        <span className="bg-emerald-50 text-emerald-900 rounded-full px-3 py-1.5">{s.agentsAvailable(rows.on.length)}</span>
        <span className="bg-indigo-50 text-indigo-800 rounded-full px-3 py-1.5">{s.arrivalsCount(dayArrivals.length)}</span>
        {gaps.map(r => (
          <span key={`g${r.from}`} className="bg-red-100 text-red-800 rounded-full px-3 py-1.5">{s.gapNoAgent(rangeText(r))}</span>
        ))}
        {strains.map(r => (
          <span key={`s${r.from}`} className="bg-amber-100 text-amber-900 rounded-full px-3 py-1.5">{s.strain(rangeText(r))}</span>
        ))}
      </div>

      <section className="bg-white rounded-2xl border border-surface-border overflow-hidden">
        <div className="relative">
          {/* Hour header */}
          <Row label={<span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{s.agent}</span>} className="h-9 bg-surface border-b border-surface-border">
            <div className="flex h-full items-center">
              {HOURS.map(m => (
                <span key={m} className="flex-1 text-[11px] font-semibold text-ink-muted">{hourLabel(m)}</span>
              ))}
            </div>
          </Row>

          {/* Demand */}
          <Row label={<span className="text-[12.5px] font-semibold text-indigo-800">{s.arrivalsRow}</span>} className="h-9">
            <div className="flex h-full items-center gap-1 pr-1">
              {cells.map(c => (
                <span key={c.minute} className="flex-1 flex justify-center">
                  {c.arrivals > 0 ? (
                    <span
                      title={c.assumed ? `${c.arrivals} · ${c.assumed} ${s.assumedNote}` : String(c.arrivals)}
                      className="w-full text-center text-[12.5px] font-bold text-indigo-800 bg-indigo-50 rounded-md py-0.5"
                      style={c.assumed ? { backgroundImage: 'repeating-linear-gradient(135deg, rgba(99,102,241,0.18) 0 4px, transparent 4px 8px)' } : undefined}
                    >
                      {c.arrivals}
                    </span>
                  ) : (
                    <span className="text-xs text-stone-300">·</span>
                  )}
                </span>
              ))}
            </div>
          </Row>

          {/* Supply */}
          <Row label={<span className="text-[12.5px] font-semibold text-emerald-900">{s.onDuty}</span>} className="h-10 border-b border-surface-border">
            <div className="flex h-full items-center gap-1 pr-1">
              {cells.map(c => (
                <span key={c.minute} className="flex-1 flex justify-center">
                  <span className={cn(
                    'w-full text-center text-[12.5px] font-bold rounded-md py-0.5',
                    c.gap ? 'bg-red-700 text-white'
                      : c.strain ? 'bg-amber-200 text-amber-900'
                      : c.agents > 0 ? 'bg-emerald-50 text-emerald-900'
                      : 'text-stone-300',
                  )}>
                    {c.agents > 0 || c.gap ? c.agents : '·'}
                  </span>
                </span>
              ))}
            </div>
          </Row>

          {/* Agents */}
          {rows.on.map(({ agent, blocks }) => {
            const total = blocks.reduce((acc, b) => acc + b.endMinute - b.startMinute, 0);
            return (
              <Row
                key={agent.id}
                className="h-14 border-b border-stone-100"
                label={
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-ink text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{initials(agent.name)}</span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-ink truncate">{agent.name}</p>
                      <p className="text-[11.5px] text-ink-muted">{s.hoursToday(formatDuration(total), blocks.length)}</p>
                    </div>
                  </div>
                }
              >
                <div
                  className="relative h-full"
                  style={{ backgroundImage: `repeating-linear-gradient(to right, #F0EFEE 0 1px, transparent 1px calc(100% / ${HOURS.length}))` }}
                >
                  {blocks.map(b => {
                    const lo = Math.max(b.startMinute, WINDOW_START);
                    const hi = Math.min(b.endMinute, WINDOW_END);
                    if (hi <= lo) return null;
                    const isOpen = open === b.id;
                    return (
                      <div key={b.id} className="absolute top-2 bottom-2" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)} - 4px)` }}>
                        <button
                          type="button"
                          onClick={() => setOpen(isOpen ? null : b.id)}
                          aria-expanded={isOpen}
                          className={cn(
                            'w-full h-full rounded-[10px] bg-teal-700 text-white text-[12.5px] font-bold px-2.5 text-left truncate hover:bg-teal-800 transition',
                            isOpen && 'ring-[3px] ring-teal-200',
                          )}
                        >
                          {b.start} – {b.end}
                        </button>
                        {isOpen && (
                          <div className="absolute left-0 bottom-full mb-2 z-20 w-64 bg-ink text-white rounded-xl px-3 py-2.5 text-[12.5px] shadow-modal space-y-1">
                            <p className="font-bold">{agent.name} · {b.start} – {b.end}</p>
                            {agent.mobileNumber && (
                              <a href={`tel:${agent.mobileNumber.replace(/\s+/g, '')}`} className="flex items-center gap-1.5 text-teal-200 font-semibold hover:text-white">
                                <Phone size={12} />{agent.mobileNumber}
                              </a>
                            )}
                            <p className="text-stone-300">{s.setAt(new Date(b.updatedAt).toLocaleString(locale === 'en' ? 'en-GB' : locale, { timeZone: 'Europe/Prague', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Row>
            );
          })}

          {rows.off.length > 0 && (
            <div className="px-5 py-3 text-[13px] text-ink-muted">
              <strong className="text-ink-soft">{s.notAvailableToday(rows.off.length)}</strong>
              {' · '}{rows.off.map(a => a.name).join(', ')}
            </div>
          )}

          {showNow && (
            <div className="pointer-events-none absolute top-9 bottom-0 left-5 right-5">
              <div className="relative h-full ml-[13rem]">
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-700" style={{ left: pct(nowInWindow!) }}>
                  <span className="absolute -top-0.5 -translate-x-1/2 text-[10.5px] font-bold text-white bg-red-700 rounded px-1">{hhmm(nowInWindow!)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-4">
          {gaps.length === 0 ? (
            <div className="bg-white rounded-2xl border border-surface-border px-5 py-4 text-sm text-emerald-900">{s.noGaps}</div>
          ) : gaps.map(r => {
            const list = dayArrivals.filter(a => a.minute >= r.from && a.minute < r.to);
            return (
              <div key={r.from} className="bg-white rounded-2xl border border-red-300 px-5 py-4 space-y-2.5">
                <p className="flex items-center gap-2 text-sm font-bold text-red-800">
                  <AlertTriangle size={16} />{s.uncoveredTitle(rangeText(r), list.length)}
                </p>
                <ul className="space-y-1.5 text-[13px]">
                  {list.map(a => (
                    <li key={a.id} className="flex justify-between gap-3">
                      <span className="truncate">{a.accommodationName}</span>
                      <span className={a.assumed ? 'font-normal text-ink-muted' : 'font-bold text-ink'}>{a.time}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/planning/check-in" className="inline-block text-[13px] font-semibold text-accent">{s.openInCheckIn}</Link>
              </div>
            );
          })}
        </div>
        <div className="bg-white rounded-2xl border border-surface-border px-5 py-4 space-y-2 text-[13px] text-ink-soft">
          <p className="text-sm font-bold text-ink">{s.legendTitle}</p>
          <Legend swatch="bg-teal-700">{s.legendBlock}</Legend>
          <Legend swatch="bg-red-700">{s.legendGap}</Legend>
          <Legend swatch="bg-amber-200">{s.legendStrain}</Legend>
          <Legend swatch="bg-indigo-50 border border-indigo-200">{s.legendArrivals}</Legend>
          <Legend
            swatch="bg-indigo-50 border border-indigo-200"
            style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(99,102,241,0.35) 0 3px, transparent 3px 6px)' }}
          >
            {s.legendAssumed}
          </Legend>
        </div>
      </div>
    </div>
  );
}

/** Label column + track column, shared by every timeline row so they line up. */
function Row({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center px-5', className)}>
      <div className="w-[13rem] flex-shrink-0 pr-3">{label}</div>
      <div className="flex-1 min-w-0 h-full">{children}</div>
    </div>
  );
}

function Legend({ swatch, style, children }: { swatch: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5">
      <span className={cn('w-7 h-3.5 rounded flex-shrink-0', swatch)} style={style} />
      {children}
    </p>
  );
}

// ─── Week ────────────────────────────────────────────────────────────────────

function WeekView({ board, today, locale, s, onOpenDay }: {
  board: AvailabilityBoard; today: string; locale: Locale; s: AvailabilityStrings; onOpenDay: (d: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(board.from, i));
  const totals = days.map(d => {
    const cells = coverage(d, board.blocks, board.arrivals);
    const minutes = board.blocks.filter(b => b.day === d).reduce((acc, b) => acc + b.endMinute - b.startMinute, 0);
    return {
      day: d,
      hours: formatDuration(minutes),
      arrivals: board.arrivals.filter(a => a.day === d).length,
      gapHours: cells.filter(c => c.gap).length,
    };
  });
  const grid = 'grid grid-cols-[13rem_repeat(7,minmax(0,1fr))] px-5';

  return (
    <section className="bg-white rounded-2xl border border-surface-border overflow-hidden">
      <div className={cn(grid, 'h-12 items-center border-b border-surface-border')}>
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{s.agent}</span>
        {days.map(d => {
          const p = dayParts(d, locale);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onOpenDay(d)}
              title={s.clickDay}
              className={cn('text-left px-2 py-1 rounded-lg hover:bg-surface-sunken transition', d === today && 'bg-emerald-50')}
            >
              <span className="block text-[11px] font-bold uppercase tracking-wider text-ink-muted">{p.dow}{d === today ? ` · ${s.todayPrefix}` : ''}</span>
              <span className="block text-[15px] font-bold text-ink leading-tight">{p.num}</span>
            </button>
          );
        })}
      </div>

      {board.agents.map(agent => {
        const mine = board.blocks.filter(b => b.userId === agent.id);
        const total = mine.reduce((acc, b) => acc + b.endMinute - b.startMinute, 0);
        return (
          <div key={agent.id} className={cn(grid, 'min-h-14 items-center border-b border-stone-100')}>
            <div className="flex items-center gap-2.5 min-w-0 py-2">
              <span className="w-8 h-8 rounded-full bg-ink text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{initials(agent.name)}</span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-ink truncate">{agent.name}</p>
                <p className="text-[11.5px] text-ink-muted">{total ? formatDuration(total) : s.nothingDeclared}</p>
              </div>
            </div>
            {days.map(d => {
              const list = mine.filter(b => b.day === d);
              const past = d < today;
              return (
                <div key={d} className={cn('flex flex-col items-start gap-1 px-2 py-2 h-full justify-center', d === today && 'bg-emerald-50/50')}>
                  {list.length === 0 ? (
                    <span className="text-sm text-stone-300">—</span>
                  ) : list.map(b => (
                    <span
                      key={b.id}
                      className={cn(
                        'text-[12.5px] rounded-lg px-2 py-0.5',
                        past ? 'bg-surface-sunken text-ink-muted font-semibold' : 'bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold',
                      )}
                    >
                      {b.start}–{b.end}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className={cn(grid, 'h-9 items-center bg-surface border-b border-stone-100 text-[12.5px]')}>
        <span className="font-semibold text-emerald-900">{s.agentHours}</span>
        {totals.map(x => <span key={x.day} className="px-2 font-bold text-emerald-900">{x.hours}</span>)}
      </div>
      <div className={cn(grid, 'h-9 items-center bg-surface border-b border-stone-100 text-[12.5px]')}>
        <span className="font-semibold text-indigo-800">{s.arrivalsRow}</span>
        {totals.map(x => <span key={x.day} className="px-2 font-bold text-indigo-800">{x.arrivals}</span>)}
      </div>
      <div className={cn(grid, 'h-10 items-center bg-surface text-[12.5px]')}>
        <span className="font-semibold text-red-800">{s.hoursNoAgent}</span>
        {totals.map(x => (
          <span key={x.day} className="px-2">
            {x.gapHours > 0
              ? <span className="font-bold text-white bg-red-700 rounded-md px-2 py-0.5">{x.gapHours}</span>
              : <span className="font-semibold text-stone-400">0</span>}
          </span>
        ))}
      </div>
    </section>
  );
}
