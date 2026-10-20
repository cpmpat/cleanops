'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { turnovers as turnoversApi, type Turnover } from '@/lib/api';
import { useLocale } from '@/lib/locale-context';
import { translations } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { formatDate, formatTime, cn, APP_TIME_ZONE } from '@/lib/utils';
import { AlertCircle, ChevronLeft, ChevronRight, ClipboardList, RefreshCw } from 'lucide-react';

// ─── Prague day helpers ──────────────────────────────────────────────────────

const pragueDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('sv-SE', { timeZone: APP_TIME_ZONE });

/** Minutes Prague is ahead of UTC at that instant (60 in winter, 120 in summer). */
function pragueOffsetMin(at: Date): number {
  const wall = at.toLocaleString('sv-SE', { timeZone: APP_TIME_ZONE, hourCycle: 'h23' });
  return (Date.parse(wall.replace(' ', 'T') + 'Z') - at.getTime()) / 60_000;
}

/** The UTC instants a Prague calendar day starts and ends at. */
function pragueDayBounds(day: string): { from: string; to: string } {
  const noon = new Date(`${day}T12:00:00Z`);
  const start = Date.parse(`${day}T00:00:00Z`) - pragueOffsetMin(noon) * 60_000;
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000 - 1).toISOString() };
}

function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// ─── Lanes ───────────────────────────────────────────────────────────────────

type Lane = 'POOL' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE';

const activeAssignments = (t: Turnover) =>
  t.assignments.filter(a => a.status !== 'REASSIGNED' && a.status !== 'REJECTED');

function laneOf(t: Turnover): Lane {
  if (t.status === 'COMPLETED' || t.status === 'FLAGGED') return 'DONE';
  if (t.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return activeAssignments(t).length > 0 ? 'ASSIGNED' : 'POOL';
}

/** The cleaners on a turnover, full name and e-mail. */
const cleaners = (t: Turnover) =>
  activeAssignments(t).map(a => ({ id: a.userId, name: a.user?.name ?? '—', email: a.user?.email ?? '' }));

/** Board columns: the four states, plus Overdue between In progress and Done when there is any. */
type Column = Lane | 'OVERDUE';

const unitName = (t: Turnover) =>
  t.toBooking?.accommodationName ?? t.fromBooking?.accommodationName ?? t.property?.name ?? '—';

/**
 * Manager dashboard (Oct 2026 redesign). Reads turnovers — the model the
 * cleaners' app works on — so "In progress" and "Completed" are what the
 * cleaners actually pressed, live over the socket.
 *
 * A turnover counts for the day when the next guest arrives that day, or it
 * was finished that day, or (today only) somebody is cleaning it right now.
 */
export default function DashboardPage() {
  const { locale } = useLocale();
  const t = translations[locale];
  const td = t.dashboard;

  const today = pragueDay(new Date());
  const [day, setDay] = useState(today);
  const [rows, setRows] = useState<Turnover[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = pragueDayBounds(day);
      setRows(await turnoversApi.byDateRange(from, to));
    } catch { /* keep the last good list */ }
    finally { setLoading(false); }
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  // Overdue moves with the clock even when nothing is pressed.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // One sync run can emit many updates — reload once per burst.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSoon = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void load(), 800);
  }, [load]);
  useSocket({
    'event:created': reloadSoon,
    'event:updated': reloadSoon,
    'event:cancelled': reloadSoon,
    'assignment:status': reloadSoon,
  });

  const isToday = day === today;

  const view = useMemo(() => {
    const mine = rows.filter(r =>
      (r.dueBy && pragueDay(r.dueBy) === day)
      || (r.completedAt && pragueDay(r.completedAt) === day)
      || (isToday && r.status === 'IN_PROGRESS'),
    );
    const byDue = (a: Turnover, b: Turnover) => (a.dueBy ?? '9').localeCompare(b.dueBy ?? '9');
    const lanes: Record<Lane, Turnover[]> = { POOL: [], ASSIGNED: [], IN_PROGRESS: [], DONE: [] };
    for (const r of mine.sort(byDue)) lanes[laneOf(r)].push(r);
    const overdue = mine.filter(r => laneOf(r) !== 'DONE' && r.dueBy && Date.parse(r.dueBy) < now);
    const late = new Set(overdue.map(r => r.id));
    // The board shows an overdue cleaning once, in Overdue; the donut still counts it by its state.
    const board: Record<Column, Turnover[]> = {
      POOL: lanes.POOL.filter(r => !late.has(r.id)),
      ASSIGNED: lanes.ASSIGNED.filter(r => !late.has(r.id)),
      IN_PROGRESS: lanes.IN_PROGRESS.filter(r => !late.has(r.id)),
      OVERDUE: overdue.sort(byDue),
      DONE: lanes.DONE,
    };
    return { total: mine.length, lanes, board, overdue: late };
  }, [rows, day, isToday, now]);

  // One colour per lane, shared by the status card, the lane headers and the tags.
  const lanes: Array<{ key: Lane; label: string; dot: string; fill: string }> = [
    { key: 'POOL', label: td.poolLane, dot: 'bg-sand', fill: '#D69A2D' },
    { key: 'ASSIGNED', label: td.assignedLane, dot: 'bg-ink-faint', fill: '#A9AEA8' },
    { key: 'IN_PROGRESS', label: td.inProgress, dot: 'bg-[#2F5DA8]', fill: '#2F5DA8' },
    { key: 'DONE', label: td.completed, dot: 'bg-accent', fill: '#1F4D3A' },
  ];
  const short: Record<Lane, string> = { POOL: td.inPool, ASSIGNED: td.assigned, IN_PROGRESS: td.inProgress, DONE: td.completed };

  const columns: Array<{ key: Column; label: string; dot: string }> = [
    ...lanes.filter(l => l.key !== 'DONE').map(l => ({ key: l.key as Column, label: l.label, dot: l.dot })),
    ...(view.board.OVERDUE.length ? [{ key: 'OVERDUE' as Column, label: td.overdue, dot: 'bg-coral' }] : []),
    { key: 'DONE', label: td.completed, dot: 'bg-accent' },
  ];

  /** Under the unit name: who (full name), when they started / finished, e-mail while assigned. */
  function Details({ r }: { r: Turnover }) {
    const state = laneOf(r);
    const b = r.toBooking;
    const people = cleaners(r);
    if (state === 'POOL') {
      // In the pool nobody has it yet — only what matters for picking it up.
      const note = !b ? td.noArrival
        : (b.isOwnerStay || r.isOwnerStay) ? td.ownerStay
        : b.pmsCreatedAt && r.dueBy && pragueDay(b.pmsCreatedAt) === pragueDay(r.dueBy) ? `${td.lastMinute} · ${formatTime(b.pmsCreatedAt)}`
        : null;
      return note ? <span className="text-[11.5px] text-ink-muted">{note}</span> : null;
    }
    // Time only when it happened today; otherwise the date too ("done 19/10 13:15").
    const stamp = (iso: string) => {
      if (pragueDay(iso) === today) return formatTime(iso);
      const [, mm, dd] = pragueDay(iso).split('-');
      return `${dd}/${mm} ${formatTime(iso)}`;
    };
    const when = state === 'IN_PROGRESS' && r.startedAt ? `${td.startedAt} ${stamp(r.startedAt)}`
      : state === 'DONE' && r.completedAt ? `${td.doneAt} ${stamp(r.completedAt)}`
      : null;
    return (
      <span className="flex flex-col gap-0.5">
        {people.map((p, i) => (
          <span key={p.id} className="flex flex-col">
            <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-soft">
              <span className="font-medium">{p.name}</span>
              {when && i === 0 && (
                <>
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-ink-faint" />
                  <span className="text-ink-muted">{when}</span>
                </>
              )}
            </span>
            {state === 'ASSIGNED' && p.email && <span className="text-[11px] text-ink-muted break-all">{p.email}</span>}
          </span>
        ))}
      </span>
    );
  }

  function tag(r: Turnover): { text: string; cls: string } {
    const state = laneOf(r);
    if (state === 'DONE') {
      return r.status === 'FLAGGED' || r.completedAllGood === false
        ? { text: td.issue, cls: 'bg-coral-soft text-coral-deep' }
        : { text: td.done, cls: 'bg-accent-soft text-accent' };
    }
    // Slow pulse: something is happening right now.
    if (state === 'IN_PROGRESS') return { text: td.inProgress, cls: 'bg-[#2F5DA8] text-white animate-[pulse_2.6s_ease-in-out_infinite]' };
    if (state === 'ASSIGNED') return { text: td.assigned, cls: 'bg-surface-sunken text-ink-soft' };
    return { text: td.inPool, cls: 'bg-sand-soft text-sand-deep' };
  }

  /** "45 min late" / "2 h 10 min late" for the Overdue column. */
  function lateBy(r: Turnover): string | null {
    if (!r.dueBy) return null;
    const m = Math.max(0, Math.round((now - Date.parse(r.dueBy)) / 60_000));
    const h = Math.floor(m / 60);
    return `${h ? `${h} h ` : ''}${m % 60} min ${td.late}`;
  }

  return (
    <div className="p-6 max-w-[1600px] flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{td.title}</h1>
          <p className="text-sm text-ink-muted">{formatDate(`${day}T12:00:00`, locale)} · {td.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} aria-label="Refresh" className="p-2 text-ink-muted hover:text-ink rounded-[10px] hover:bg-surface-sunken transition">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div role="group" aria-label="Day" className="flex items-center gap-1 bg-white border border-surface-border rounded-[10px] p-[3px]">
            <button onClick={() => setDay(d => shiftDay(d, -1))} aria-label="Previous day" className="p-1.5 rounded-lg text-ink-soft hover:bg-surface-sunken transition">
              <ChevronLeft size={15} />
            </button>
            {([[today, td.today], [shiftDay(today, 1), td.tomorrow]] as const).map(([d, label]) => (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={cn('px-3 py-1.5 rounded-lg text-[13px] transition',
                  day === d ? 'bg-accent text-white font-semibold' : 'text-ink-soft hover:bg-surface-sunken')}
              >
                {label}
              </button>
            ))}
            <button onClick={() => setDay(d => shiftDay(d, 1))} aria-label="Next day" className="p-1.5 rounded-lg text-ink-soft hover:bg-surface-sunken transition">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Cleaning status — one card instead of five figures (20 Oct 2026). */}
      <StatusCard
        title={td.statusTitle}
        total={view.total}
        totalLabel={td.total}
        overdue={view.overdue.size}
        overdueLabel={td.overdueCleanings}
        loading={loading && !rows.length}
        parts={lanes.map(l => ({ key: l.key, label: short[l.key], fill: l.fill, n: view.lanes[l.key].length }))}
      />

      {/* Lanes */}
      {!loading && view.total === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <p className="font-semibold text-ink">{td.noEvents}</p>
        </div>
      ) : (
        // Four columns, five while anything is overdue — always the status card's width.
        <div className={cn('grid gap-3 items-start grid-cols-1 md:grid-cols-2', columns.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
          {columns.map(c => {
            const items = view.board[c.key];
            return (
              <section key={c.key} className={cn('bg-white border rounded-2xl flex flex-col overflow-hidden min-w-0',
                c.key === 'OVERDUE' ? 'border-coral/40' : 'border-surface-border')}>
                <div className={cn('flex items-center justify-between px-4 py-3 border-b border-surface-border', c.key === 'OVERDUE' && 'bg-coral-soft/40')}>
                  <h2 className={cn('text-xs font-semibold flex items-center gap-2', c.key === 'OVERDUE' ? 'text-coral-deep' : 'text-ink')}>
                    <span className={cn('w-2 h-2 rounded-full', c.dot)} />{c.label}
                  </h2>
                  <span className="font-mono text-[11.5px] text-ink-muted">{items.length}</span>
                </div>
                {items.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-ink-faint">—</p>}
                <div className="divide-y divide-surface-border/70">
                  {items.map(r => {
                    const tg = tag(r);
                    const assumed = r.toBooking?.checkInSource === 'FALLBACK';
                    return (
                      <div key={r.id} className="flex items-start gap-2.5 px-4 py-2.5" title={r.managerNote ?? undefined}>
                        <span className={cn('font-mono w-11 flex-shrink-0 text-[12.5px] leading-[1.35]', assumed ? 'text-sand-deep' : 'font-semibold text-ink')}>
                          {r.dueBy ? formatTime(r.dueBy) : '—'}
                        </span>
                        {/* Full unit name (wraps), then who/when, then the status tag — nothing is cut. */}
                        <span className="flex-1 min-w-0 flex flex-col items-start gap-1">
                          <span className="text-[13px] font-semibold text-ink leading-[1.35] break-words">{unitName(r)}</span>
                          <Details r={r} />
                          <span className="flex flex-wrap items-center gap-2">
                            <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', tg.cls)}>{tg.text}</span>
                            {c.key === 'OVERDUE' && <span className="text-[11px] font-semibold text-coral-deep">{lateBy(r)}</span>}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The day's cleanings as one picture: a donut split by lane with the total in
 * the middle, overdue and the per-lane counts (with shares) beside it.
 */
function StatusCard({ title, total, totalLabel, overdue, overdueLabel, parts, loading }: {
  title: string;
  total: number;
  totalLabel: string;
  overdue: number;
  overdueLabel: string;
  loading: boolean;
  parts: Array<{ key: string; label: string; fill: string; n: number }>;
}) {
  // Donut geometry: r 70, stroke 22, small gap between segments.
  const R = 70;
  const C = 2 * Math.PI * R;
  const GAP = parts.filter(p => p.n > 0).length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = parts.filter(p => p.n > 0).map(p => {
    const len = total ? (p.n / total) * C : 0;
    const arc = { ...p, dash: Math.max(0, len - GAP), offset };
    offset += len;
    return arc;
  });
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <section className="bg-white border border-surface-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-border">
        <span className="w-9 h-9 rounded-[10px] border border-surface-border flex items-center justify-center text-ink-soft">
          <ClipboardList size={17} />
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      </div>
      <div className="px-5 py-5 flex flex-wrap items-center gap-x-10 gap-y-5">
        {/* Donut with the total in the middle */}
        <div className="relative w-[180px] h-[180px] flex-shrink-0">
          <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90" aria-hidden>
            <circle cx="90" cy="90" r={R} fill="none" stroke="#EFEBE3" strokeWidth="22" />
            {!loading && arcs.map(a => (
              <circle
                key={a.key}
                cx="90" cy="90" r={R} fill="none"
                stroke={a.fill} strokeWidth="22"
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                strokeDashoffset={-a.offset}
                className="transition-all duration-500"
              >
                <title>{`${a.label}: ${a.n}`}</title>
              </circle>
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[34px] font-semibold tracking-tight text-ink leading-none tabular-nums">{loading ? '\u2013' : total}</span>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{totalLabel}</span>
          </div>
        </div>

        {/* Overdue + the lanes */}
        <div className="flex-1 min-w-[260px] flex flex-col gap-3">
          <div className={cn('flex items-center justify-between gap-3 rounded-full border px-5 py-2.5',
            overdue > 0 ? 'bg-coral-soft/50 border-coral/30' : 'bg-surface border-surface-border')}>
            <span className="text-[13.5px] text-ink-soft">
              {overdueLabel}: <span className={cn('ml-1 text-[20px] font-semibold align-middle', overdue > 0 ? 'text-coral-deep' : 'text-ink')}>{loading ? '\u2013' : overdue}</span>
            </span>
            {overdue > 0 && <AlertCircle size={18} className="text-coral" />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
            {parts.map(p => (
              <div key={p.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13.5px] text-ink-soft">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                  {p.label}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[24px] font-semibold tracking-tight text-ink tabular-nums">{loading ? '\u2013' : p.n}</span>
                  <span className="w-9 text-right font-mono text-[11.5px] text-ink-muted">{loading ? '' : `${pct(p.n)}%`}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
