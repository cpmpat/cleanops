'use client';
import { useMemo } from 'react';
import type { PlanningBooking } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Brush, Flame, UserX } from 'lucide-react';

const pragueDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
const pragueHour = (iso: string) =>
  Number(new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Prague', hour: '2-digit', hourCycle: 'h23' }));
const street = (name: string) => name.split(' - ')[0];
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

type Attention = {
  id: string;
  unit: string;
  why: string;
  tag: string;
  tone: 'coral' | 'sand' | 'neutral';
  icon: React.ElementType;
  rank: number;
  at: string;
};

/** Hour buckets the arrivals chart shows. */
const BUCKETS: Array<{ label: string; from: number; to: number }> = [
  { label: '–12', from: 0, to: 12 },
  { label: '12–15', from: 12, to: 15 },
  { label: '15–18', from: 15, to: 18 },
  { label: '18–21', from: 18, to: 21 },
  { label: '21–', from: 21, to: 24 },
];

/**
 * The cards above the Check-In list (Oct 2026 redesign): headline figures,
 * what needs attention, arrivals by hour and each agent's day. Everything is
 * computed from the list already loaded — no extra request — so it always
 * agrees with the rows below it.
 */
export function PlanningSummary({ bookings, onPick }: { bookings: PlanningBooking[]; onPick: (id: string) => void }) {
  const s = useMemo(() => {
    const guests = bookings.filter(b => !b.isOwnerStay);
    const noAgent = guests.filter(b => !b.checkInAgentId);
    const assumed = bookings.filter(b => b.checkInSource === 'FALLBACK');
    const reports = bookings.filter(b => b.checkInReport);
    const lowReports = reports.filter(b => (b.checkInReport?.scores.CLEANLINESS ?? 5) < 3);
    const owner = bookings.length - guests.length;
    const firstNoAgent = noAgent
      .map(b => b.checkInTime)
      .sort()[0];
    const firstNoAgentTime = firstNoAgent ? hhmm(firstNoAgent) : null;

    // Needs attention: every check-in not processed yet — no agent, or no
    // cleaner on the turnover before it. Last-minute ones go first and leave
    // the list like any other once both are set. Owner stays need a cleaner
    // only (no agent meets the owner).
    const today = pragueDay(new Date().toISOString());
    const att: Attention[] = [];
    for (const b of bookings) {
      const owner = !!b.isOwnerStay;
      const noAgent = !owner && !b.checkInAgentId;
      const noCleaner = !b.assignments.some(a => a.status !== 'REASSIGNED' && a.status !== 'REJECTED')
        && b.status !== 'COMPLETED' && b.status !== 'IN_PROGRESS';
      if (!noAgent && !noCleaner) continue;
      const lastMinute = !!b.pmsCreatedAt && pragueDay(b.pmsCreatedAt) === today && pragueDay(b.checkInTime) === today;
      const missing = [noAgent && 'no agent', noCleaner && 'no cleaner'].filter(Boolean).join(' · ');
      const declined = noAgent && b.checkInDeclinedAgentName ? ` · ${b.checkInDeclinedAgentName} declined` : '';
      att.push({
        id: b.id,
        unit: street(b.accommodationName),
        why: `${hhmm(b.checkInTime)} · ${missing}${declined}`,
        tag: lastMinute ? 'Last minute' : noAgent && noCleaner ? 'Both missing' : noAgent ? 'No agent' : 'No cleaner',
        tone: lastMinute || (noAgent && noCleaner) ? 'coral' : 'sand',
        icon: lastMinute ? Flame : noAgent ? UserX : Brush,
        rank: lastMinute ? 0 : noAgent && noCleaner ? 1 : 2,
        at: b.checkInTime,
      });
    }
    att.sort((a, b) => a.rank - b.rank || a.at.localeCompare(b.at));

    // Arrivals by hour, with / without agent.
    const buckets = BUCKETS.map(k => {
      const inside = guests.filter(b => { const h = pragueHour(b.checkInTime); return h >= k.from && h < k.to; });
      return { ...k, total: inside.length, withAgent: inside.filter(b => b.checkInAgentId).length };
    });
    const maxBucket = Math.max(1, ...buckets.map(b => b.total));

    // Each agent's day in this list.
    const byAgent = new Map<string, { name: string; count: number; red: number; amber: number; first: string }>();
    for (const b of guests) {
      if (!b.checkInAgentId) continue;
      const cur = byAgent.get(b.checkInAgentId) ?? { name: b.checkInAgentName ?? '—', count: 0, red: 0, amber: 0, first: b.checkInTime };
      cur.count++;
      if (b.legIn?.state === 'IMPOSSIBLE') cur.red++;
      if (b.legIn?.state === 'TIGHT') cur.amber++;
      if (b.checkInTime < cur.first) cur.first = b.checkInTime;
      byAgent.set(b.checkInAgentId, cur);
    }
    const agents = Array.from(byAgent.values()).sort((a, b) => b.count - a.count);
    const maxAgent = Math.max(1, ...agents.map(a => a.count));

    return { total: bookings.length, owner, noAgent: noAgent.length, firstNoAgentTime, assumed: assumed.length, reports: reports.length, lowReports: lowReports.length, att, buckets, maxBucket, agents, maxAgent };
  }, [bookings]);

  const tone = {
    coral: 'bg-coral-soft text-coral-deep',
    sand: 'bg-sand-soft text-sand-deep',
    neutral: 'bg-surface-sunken text-ink-soft',
  } as const;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <Kpi label="Check-ins" value={s.total} unit="in view" chip={s.owner ? `${s.owner} owner stay${s.owner === 1 ? '' : 's'}` : null} chipTone="bg-accent-soft text-accent" />
        <Kpi label="Without agent" value={s.noAgent} unit="check-ins" chip={s.firstNoAgentTime ? `first at ${s.firstNoAgentTime}` : null} chipTone="bg-coral-soft text-coral-deep" />
        <Kpi label="Time not confirmed" value={s.assumed} unit="assumed" chip={s.assumed ? 'pick the time to confirm' : null} chipTone="bg-sand-soft text-sand-deep" />
        <Kpi label="Agent reports" value={s.reports} unit="received" chip={s.lowReports ? `${s.lowReports} cleanliness below 3` : null} chipTone="bg-coral-soft text-coral-deep" />
      </div>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
        <section className="bg-white border border-surface-border rounded-2xl p-4 flex flex-col gap-2.5">
          <h2 className="flex items-center justify-between text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">
            Needs attention
            {s.att.length > 0 && <span className="rounded-full bg-coral text-white px-2 py-0.5 text-[10px] tracking-normal">{s.att.length}</span>}
          </h2>
          {s.att.length === 0 && <p className="text-sm text-accent py-2">Everything in view has an agent and a cleaner.</p>}
          <div className="flex flex-col gap-1 max-h-[232px] overflow-y-auto -mr-2 pr-2">
          {s.att.map((a, i) => (
            <button key={`${a.id}-${i}`} type="button" onClick={() => onPick(a.id)} className="flex items-center gap-2.5 text-left rounded-xl -mx-1.5 px-1.5 py-1 hover:bg-surface transition">
              <span className={cn('w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0', tone[a.tone])}>
                <a.icon size={14} />
              </span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-[13px] font-semibold text-ink truncate">{a.unit}</span>
                <span className="text-[11.5px] text-ink-muted truncate">{a.why}</span>
              </span>
              <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold flex-shrink-0', a.rank === 0 ? 'bg-coral text-white' : tone[a.tone])}>{a.tag}</span>
            </button>
          ))}
          </div>
        </section>

        <section className="bg-white border border-surface-border rounded-2xl p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">Arrivals by hour</h2>
            <span className="text-[11px] text-ink-muted">{s.assumed ? `${s.assumed} at an assumed time` : 'all times confirmed'}</span>
          </div>
          <div className="grid grid-cols-5 gap-2.5 items-end h-[130px]">
            {s.buckets.map(k => (
              <div key={k.label} className="h-full flex flex-col justify-end bg-surface-sunken rounded-[10px] overflow-hidden" title={`${k.label}: ${k.total} arrivals, ${k.withAgent} with an agent`}>
                {k.total - k.withAgent > 0 && (
                  <div className="bg-coral text-white text-[11px] font-bold flex items-start justify-center pt-1" style={{ height: `${((k.total - k.withAgent) / s.maxBucket) * 100}%`, minHeight: 18 }}>
                    {k.total - k.withAgent}
                  </div>
                )}
                {k.withAgent > 0 && (
                  <div className="bg-accent text-white text-[11px] font-bold flex items-center justify-center" style={{ height: `${(k.withAgent / s.maxBucket) * 100}%`, minHeight: 18 }}>
                    {k.withAgent}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-2.5 text-center text-[11px] text-ink-muted font-mono">
            {s.buckets.map(k => <span key={k.label}>{k.label}</span>)}
          </div>
          <div className="flex gap-3 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-accent" />with agent</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-coral" />without agent</span>
          </div>
        </section>

        <section className="bg-white border border-surface-border rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">Agents in view</h2>
          {s.agents.length === 0 && <p className="text-sm text-ink-muted py-2">No agent assigned yet.</p>}
          {s.agents.slice(0, 5).map(a => (
            <div key={a.name} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                  {a.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                </span>
                <span className="flex-1 text-[13px] font-semibold text-ink truncate">{a.name}</span>
                <span className="text-[11.5px] text-ink-muted font-mono">{a.count} check-in{a.count === 1 ? '' : 's'}</span>
              </div>
              <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                <div className={cn('h-full', a.red ? 'bg-coral' : a.amber ? 'bg-sand' : 'bg-accent')} style={{ width: `${(a.count / s.maxAgent) * 100}%` }} />
              </div>
              {(a.red > 0 || a.amber > 0) && (
                <span className="text-[11px] text-ink-muted">
                  {a.red > 0 && <span className="text-coral-deep font-semibold">{a.red} leg{a.red === 1 ? '' : 's'} too far</span>}
                  {a.red > 0 && a.amber > 0 && ' · '}
                  {a.amber > 0 && <span className="text-sand-deep font-semibold">{a.amber} tight</span>}
                </span>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, chip, chipTone }: { label: string; value: number; unit: string; chip: string | null; chipTone: string }) {
  return (
    <div className="bg-white border border-surface-border rounded-2xl px-4 py-3.5 flex flex-col gap-2">
      <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[28px] font-semibold tracking-tight text-ink leading-none">{value}</span>
        <span className="text-[13px] text-ink-muted">{unit}</span>
      </span>
      <span className="min-h-[20px]">
        {chip && <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', chipTone)}>{chip}</span>}
      </span>
    </div>
  );
}
