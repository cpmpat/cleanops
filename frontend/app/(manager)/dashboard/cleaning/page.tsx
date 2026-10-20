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

const cleanerNames = (t: Turnover) =>
  activeAssignments(t).map(a => a.user?.name?.split(' ')[0]).filter(Boolean).join(', ');

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
    return { total: mine.length, lanes, overdue: new Set(overdue.map(r => r.id)) };
  }, [rows, day, isToday, now]);

  // One colour per lane, shared by the status card, the lane headers and the tags.
  const lanes: Array<{ key: Lane; label: string; dot: string; fill: string }> = [
    { key: 'POOL', label: td.poolLane, dot: 'bg-sand', fill: '#D69A2D' },
    { key: 'ASSIGNED', label: td.assignedLane, dot: 'bg-ink-faint', fill: '#A9AEA8' },
    { key: 'IN_PROGRESS', label: td.inProgress, dot: 'bg-[#2F5DA8]', fill: '#2F5DA8' },
    { key: 'DONE', label: td.completed, dot: 'bg-accent', fill: '#1F4D3A' },
  ];
  const short: Record<Lane, string> = { POOL: td.inPool, ASSIGNED: td.assigned, IN_PROGRESS: td.inProgress, DONE: td.completed };

  function sub(r: Turnover, lane: Lane): string {
    const who = cleanerNames(r);
    const b = r.toBooking;
    if (lane === 'IN_PROGRESS') return [who, r.startedAt && `${td.startedAt} ${formatTime(r.startedAt)}`].filter(Boolean).join(' · ');
    if (lane === 'DONE') return [who, r.completedAt && `${td.doneAt} ${formatTime(r.completedAt)}`].filter(Boolean).join(' · ');
    if (lane === 'ASSIGNED') return who;
    if (!b) return td.noArrival;
    if (b.isOwnerStay || r.isOwnerStay) return td.ownerStay;
    if (b.pmsCreatedAt && r.dueBy && pragueDay(b.pmsCreatedAt) === pragueDay(r.dueBy)) {
      return `${td.lastMinute} · ${formatTime(b.pmsCreatedAt)}`;
    }
    return `${b.numAdults}+${b.numChildren}`;
  }

  function tag(r: Turnover, lane: Lane): { text: string; cls: string } {
    if (view.overdue.has(r.id)) return { text: td.overdue, cls: 'bg-coral text-white' };
    if (lane === 'DONE') {
      return r.status === 'FLAGGED' || r.completedAllGood === false
        ? { text: td.issue, cls: 'bg-coral-soft text-coral-deep' }
        : { text: td.done, cls: 'bg-accent-soft text-accent' };
    }
    // Slow pulse: something is happening right now.
    if (lane === 'IN_PROGRESS') return { text: td.inProgress, cls: 'bg-[#2F5DA8] text-white animate-[pulse_2.6s_ease-in-out_infinite]' };
    if (lane === 'ASSIGNED') return { text: td.assigned, cls: 'bg-surface-sunken text-ink-soft' };
    return { text: td.inPool, cls: 'bg-sand-soft text-sand-deep' };
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
        <div className="grid gap-3 items-start grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
          {lanes.map(l => {
            const items = view.lanes[l.key];
            return (
              <section key={l.key} className="bg-white border border-surface-border rounded-2xl flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
                  <h2 className="text-xs font-semibold text-ink flex items-center gap-2">
                    <span className={cn('w-2 h-2 rounded-full', l.dot)} />{l.label}
                  </h2>
                  <span className="font-mono text-[11.5px] text-ink-muted">{items.length}</span>
                </div>
                {items.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-ink-faint">—</p>}
                <div className="divide-y divide-surface-border/70">
                  {items.map(r => {
                    const tg = tag(r, l.key);
                    const assumed = r.toBooking?.checkInSource === 'FALLBACK';
                    return (
                      <div key={r.id} className="flex items-start gap-2.5 px-4 py-2.5" title={r.managerNote ?? undefined}>
                        <span className={cn('font-mono w-11 flex-shrink-0 text-[12.5px] leading-[1.35]', assumed ? 'text-sand-deep' : 'font-semibold text-ink')}>
                          {r.dueBy ? formatTime(r.dueBy) : '—'}
                        </span>
                        {/* Full unit name (wraps), then who/when, then the status tag — nothing is cut. */}
                        <span className="flex-1 min-w-0 flex flex-col items-start gap-1">
                          <span className="text-[13px] font-semibold text-ink leading-[1.35] break-words">{unitName(r)}</span>
                          {sub(r, l.key) && <span className="text-[11.5px] text-ink-muted">{sub(r, l.key)}</span>}
                          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', tg.cls)}>{tg.text}</span>
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
 * The day's cleanings as one picture: overdue on top, a bar split by lane
 * (hatched blocks, widths by count) and the counts underneath.
 */
function StatusCard({ title, total, overdue, overdueLabel, parts, loading }: {
  title: string;
  total: number;
  overdue: number;
  overdueLabel: string;
  loading: boolean;
  parts: Array<{ key: string; label: string; fill: string; n: number }>;
}) {
  const shown = parts.filter(p => p.n > 0);
  const hatch = 'repeating-linear-gradient(115deg, rgba(255,255,255,0.22) 0 1.5px, transparent 1.5px 9px)';
  return (
    <section className="bg-white border border-surface-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-border">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-[10px] border border-surface-border flex items-center justify-center text-ink-soft">
            <ClipboardList size={17} />
          </span>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        </div>
        <span className="font-mono text-[12.5px] text-ink-muted">{loading ? '–' : total}</span>
      </div>
      <div className="px-5 py-4 flex flex-col gap-4">
        <div className={cn('flex items-center justify-between gap-3 rounded-full border px-5 py-2.5',
          overdue > 0 ? 'bg-coral-soft/50 border-coral/30' : 'bg-surface border-surface-border')}>
          <span className="text-[13.5px] text-ink-soft">
            {overdueLabel}: <span className={cn('ml-1 text-[20px] font-semibold align-middle', overdue > 0 ? 'text-coral-deep' : 'text-ink')}>{loading ? '–' : overdue}</span>
          </span>
          {overdue > 0 && <AlertCircle size={18} className="text-coral" />}
        </div>
        <div className="flex gap-2 h-[112px]">
          {shown.length === 0 ? (
            <div className="flex-1 rounded-2xl bg-surface-sunken" />
          ) : shown.map(p => (
            <div
              key={p.key}
              title={`${p.label}: ${p.n}`}
              className="rounded-2xl min-w-[28px] transition-all"
              style={{ flexGrow: p.n, flexBasis: 0, backgroundColor: p.fill, backgroundImage: hatch }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-2">
          {parts.map(p => (
            <div key={p.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13.5px] text-ink-soft">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill }} />
                {p.label}
              </span>
              <span className="text-[24px] font-semibold tracking-tight text-ink tabular-nums">{loading ? '–' : p.n}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
