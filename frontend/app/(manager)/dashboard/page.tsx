'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { turnovers as turnoversApi, type Turnover } from '@/lib/api';
import { useLocale } from '@/lib/locale-context';
import { translations } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { formatDate, formatTime, cn, APP_TIME_ZONE } from '@/lib/utils';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

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

  const pct = (n: number) => `${view.total ? Math.round((n / view.total) * 100) : 0}%`;
  const kpis = [
    { label: td.total, value: view.total, bar: view.total ? '100%' : '0%', text: 'text-ink', fill: 'bg-ink' },
    { label: td.completed, value: view.lanes.DONE.length, bar: pct(view.lanes.DONE.length), text: 'text-accent', fill: 'bg-accent' },
    { label: td.inProgress, value: view.lanes.IN_PROGRESS.length, bar: pct(view.lanes.IN_PROGRESS.length), text: 'text-ink-soft', fill: 'bg-ink-soft' },
    { label: td.inPool, value: view.lanes.POOL.length, bar: pct(view.lanes.POOL.length), text: 'text-sand-deep', fill: 'bg-sand' },
    { label: td.overdue, value: view.overdue.size, bar: pct(view.overdue.size), text: 'text-coral-deep', fill: 'bg-coral' },
  ];

  const lanes: Array<{ key: Lane; label: string; dot: string }> = [
    { key: 'POOL', label: td.poolLane, dot: 'bg-sand' },
    { key: 'ASSIGNED', label: td.assignedLane, dot: 'bg-ink-faint' },
    { key: 'IN_PROGRESS', label: td.inProgress, dot: 'bg-ink-soft' },
    { key: 'DONE', label: td.completed, dot: 'bg-accent' },
  ];

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
    if (lane === 'IN_PROGRESS') return { text: td.cleaning, cls: 'bg-accent text-white' };
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

      {/* Figures */}
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        {kpis.map(k => (
          <div key={k.label} className="bg-white border border-surface-border rounded-2xl px-4 py-3.5 flex flex-col gap-2">
            <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">{k.label}</span>
            <span className={cn('text-[28px] font-semibold tracking-tight leading-none', k.text)}>{loading && !rows.length ? '–' : k.value}</span>
            <div className="h-[5px] bg-surface-sunken rounded-full overflow-hidden">
              <div className={cn('h-full transition-all', k.fill)} style={{ width: k.bar }} />
            </div>
          </div>
        ))}
      </div>

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
                      <div key={r.id} className="flex items-center gap-2.5 px-4 py-2.5" title={r.managerNote ?? undefined}>
                        <span className={cn('font-mono w-11 flex-shrink-0 text-[12.5px]', assumed ? 'text-sand-deep' : 'font-semibold text-ink')}>
                          {r.dueBy ? formatTime(r.dueBy) : '—'}
                        </span>
                        <span className="flex-1 min-w-0 flex flex-col">
                          <span className="text-[13px] font-semibold text-ink truncate">{unitName(r)}</span>
                          <span className="text-[11.5px] text-ink-muted truncate">{sub(r, l.key) || ' '}</span>
                        </span>
                        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold flex-shrink-0', tg.cls)}>{tg.text}</span>
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
