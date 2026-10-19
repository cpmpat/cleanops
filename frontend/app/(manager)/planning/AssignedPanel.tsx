'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { integrations, type CheckInRoute } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowDown, Phone, X } from 'lucide-react';
import { legLabel, legTone, street } from './legText';

const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
};

/**
 * Split view "Assigned": the chosen agents' check-ins in time order, with the
 * leg between consecutive ones and a footer per day. Available at any time —
 * the desk wants to inspect a route halfway through planning too; the
 * unassigned count says how complete the picture is.
 */
export function AssignedPanel({
  from, to, refreshKey, highlight, onPick, onClose,
}: {
  from: string;
  to: string;
  /** Changes when the main list reloads, so both sides agree. */
  refreshKey: unknown;
  highlight: string | null;
  onPick: (bookingId: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<CheckInRoute | null>(null);
  const [error, setError] = useState('');
  // null = "everyone with check-ins in the range" (the server's default).
  const [picked, setPicked] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await integrations.planning.route(from, to, picked ?? undefined));
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    }
  }, [from, to, picked]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const shown = useMemo(() => new Set(data?.columns.map(c => c.agentId) ?? []), [data]);

  function toggle(id: string) {
    const current = picked ?? Array.from(shown);
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    setPicked(next);
  }

  return (
    <aside className="w-[25rem] flex-shrink-0 bg-white rounded-2xl border border-surface-border overflow-hidden sticky top-4 max-h-[calc(100vh-2rem)] flex flex-col">
      <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">Assigned</p>
          <p className="text-[11px] text-ink-muted">
            {from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`}
            {data && ` · ${data.serviceMinutes} min per check-in, ${data.bufferMinutes} min buffer`}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-sunken text-ink-muted"><X size={16} /></button>
      </div>

      {data && data.unassignedCount > 0 && (
        <p className="mx-4 mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {data.unassignedCount} check-in{data.unassignedCount === 1 ? '' : 's'} in this range still without an agent
        </p>
      )}

      {data && (
        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {data.agents.map(a => {
            const on = shown.has(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggle(a.id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition',
                  on ? 'bg-ink text-white border-ink' : 'bg-white text-ink-soft border-surface-border hover:border-ink-muted',
                )}
              >
                {a.name.split(' ')[0]} <span className={on ? 'text-white/60' : 'text-ink-faint'}>{a.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="m-4 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {data && data.columns.length === 0 && (
          <p className="text-sm text-ink-faint text-center py-8">No agent has check-ins in this range.</p>
        )}
        {data?.columns.map(col => (
          <section key={col.agentId} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">{col.name}</p>
              {col.mobileNumber && (
                <a href={`tel:${col.mobileNumber}`} className="text-[11px] text-ink-muted flex items-center gap-1 hover:text-accent">
                  <Phone size={11} />{col.mobileNumber}
                </a>
              )}
            </div>
            {col.days.length === 0 && <p className="text-xs text-ink-faint">Nothing assigned in this range.</p>}
            {col.days.map(d => (
              <div key={d.day} className="rounded-xl border border-surface-border overflow-hidden">
                <p className="px-3 py-1.5 bg-surface-sunken/70 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{dayLabel(d.day)}</p>
                <div className="px-3 py-2">
                  {d.items.map(i => (
                    <div key={i.bookingId}>
                      {i.legIn && (
                        <p className={cn('flex items-center gap-1.5 pl-1 py-1 text-[11px]', legTone[i.legIn.state])}>
                          <ArrowDown size={11} className="flex-shrink-0" />
                          {legLabel(i.legIn)}
                        </p>
                      )}
                      <button
                        onClick={() => onPick(i.bookingId)}
                        className={cn(
                          'w-full text-left flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition',
                          highlight === i.bookingId ? 'bg-accent-soft ring-1 ring-accent' : 'hover:bg-surface-sunken',
                        )}
                      >
                        <span className={cn('text-sm font-bold tabular-nums w-11 flex-shrink-0', i.arrivalAssumed ? 'text-amber-700' : 'text-ink')}>
                          {i.time}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-ink truncate">{street(i.accommodationName)}</span>
                          <span className="block text-[11px] text-ink-muted truncate">
                            {i.accommodationName.split(',').slice(1).join(',').trim() || i.bookingRef} · {i.guests}
                            {i.arrivalAssumed && <span className="text-amber-700"> · time unconfirmed</span>}
                          </span>
                        </span>
                        {i.consent === 'PENDING' && <span title="Waiting for the agent to accept" className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-1.5">?</span>}
                        {!i.seen && i.consent !== 'PENDING' && <span title="Not seen by the agent yet" className="mt-1.5 w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="px-3 py-1.5 border-t border-surface-border text-[11px] text-ink-muted flex flex-wrap gap-x-2">
                  <span><strong className="text-ink-soft">{d.footer.count}</strong> check-in{d.footer.count === 1 ? '' : 's'}</span>
                  {d.footer.first && <span>{d.footer.first}–{d.footer.last}</span>}
                  {d.footer.travelMinutes > 0 && <span>{d.footer.travelMinutes} min travel</span>}
                  {d.footer.red > 0 && <span className="text-red-600 font-semibold">{d.footer.red} won’t make it</span>}
                  {d.footer.amber > 0 && <span className="text-amber-700 font-semibold">{d.footer.amber} tight</span>}
                  {d.footer.unknownLegs > 0 && <span className="text-ink-faint">{d.footer.unknownLegs} leg{d.footer.unknownLegs === 1 ? '' : 's'} unknown</span>}
                </p>
              </div>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
