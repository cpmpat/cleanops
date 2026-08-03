'use client';
import { useState, useEffect, useCallback } from 'react';
import { events as eventsApi, type CleaningEvent, type DayStats } from '@/lib/api';
import { EventCard } from '@/components/EventCard';
import { EventDetailSheet } from '@/components/EventDetailSheet';
import { useAuth } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { translations } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { todayISO, formatDate } from '@/lib/utils';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { user } = useAuth();
  const { locale } = useLocale();
  const t = translations[locale];

  const [date, setDate] = useState(todayISO());
  const [eventList, setEventList] = useState<CleaningEvent[]>([]);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [selected, setSelected] = useState<CleaningEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [evts, st] = await Promise.all([
        eventsApi.byDate(date),
        eventsApi.stats(date),
      ]);
      setEventList(evts);
      setStats(st);
    } catch {}
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  useSocket({
    'event:created': () => load(),
    'event:updated': (u: CleaningEvent) => {
      // The PMS sync emits an aggregate payload ({ source: 'pms-sync', … })
      // rather than a single event, because one run can change hundreds of
      // rows. It carries no id, so patch-in-place cannot apply — reload.
      if (!u?.id) { load(); return; }
      setEventList(prev => prev.map(e => e.id === u.id ? u : e));
      if (selected?.id === u.id) setSelected(u);
    },
    'event:cancelled': (c: CleaningEvent) => {
      setEventList(prev => prev.map(e => e.id === c.id ? c : e));
    },
    'assignment:status': () => load(),
  });

  function shiftDate(days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(d.toLocaleDateString('sv-SE'));
  }

  const isToday = date === todayISO();
  const pendingEvents = eventList.filter(e => e.status === 'PENDING');
  const activeEvents = eventList.filter(e => ['ASSIGNED', 'IN_PROGRESS'].includes(e.status));
  const doneEvents = eventList.filter(e => e.status === 'COMPLETED');
  const cancelledEvents = eventList.filter(e => e.status === 'CANCELLED');

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t.dashboard.title}</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {isToday ? `${t.general.loading.replace('...','')}, ` : ''}{formatDate(date + 'T12:00:00', locale)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex items-center gap-1 bg-white border border-surface-border rounded-xl p-1">
            <button onClick={() => shiftDate(-1)} className="p-1.5 rounded-lg hover:bg-surface-sunken transition">
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setDate(todayISO())}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition',
                isToday ? 'bg-ink text-white' : 'text-ink-muted hover:bg-surface-sunken'
              )}
            >
              Today
            </button>
            <button onClick={() => shiftDate(1)} className="p-1.5 rounded-lg hover:bg-surface-sunken transition">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { label: t.dashboard.total, value: stats.total, color: 'text-ink' },
            { label: t.dashboard.completed, value: stats.completed, color: 'text-emerald-600' },
            { label: t.dashboard.inProgress, value: stats.inProgress, color: 'text-violet-600' },
            { label: t.dashboard.pending, value: stats.pending, color: 'text-amber-600' },
            { label: t.dashboard.overdue, value: stats.overdue, color: 'text-red-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-surface-border p-4 shadow-card">
              <p className={cn('text-2xl font-bold', color)}>{value}</p>
              <p className="text-xs text-ink-muted mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Event sections */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-white rounded-2xl border border-surface-border animate-pulse" />)}
        </div>
      ) : eventList.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <p className="text-4xl mb-3">📭</p>
          <p className="font-semibold text-ink">{t.dashboard.noEvents}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingEvents.length > 0 && (
            <Section title={`⚠ ${t.status.PENDING}`} count={pendingEvents.length}>
              {pendingEvents.map(e => <EventCard key={e.id} event={e} t={t} isManager onClick={() => setSelected(e)} />)}
            </Section>
          )}
          {activeEvents.length > 0 && (
            <Section title={`▶ ${t.status.IN_PROGRESS}`} count={activeEvents.length}>
              {activeEvents.map(e => <EventCard key={e.id} event={e} t={t} isManager onClick={() => setSelected(e)} />)}
            </Section>
          )}
          {doneEvents.length > 0 && (
            <Section title={`✓ ${t.status.COMPLETED}`} count={doneEvents.length}>
              {doneEvents.map(e => <EventCard key={e.id} event={e} t={t} isManager onClick={() => setSelected(e)} />)}
            </Section>
          )}
          {cancelledEvents.length > 0 && (
            <Section title={t.status.CANCELLED} count={cancelledEvents.length} muted>
              {cancelledEvents.map(e => <EventCard key={e.id} event={e} t={t} isManager onClick={() => setSelected(e)} />)}
            </Section>
          )}
        </div>
      )}

      {selected && (
        <EventDetailSheet
          event={selected}
          t={t}
          isManager
          onClose={() => setSelected(null)}
          onStatusChange={load}
        />
      )}
    </div>
  );
}

function Section({ title, count, children, muted }: {
  title: string; count: number; children: React.ReactNode; muted?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={cn('text-sm font-semibold', muted ? 'text-ink-muted' : 'text-ink')}>{title}</h2>
        <span className="text-xs text-ink-faint bg-surface-sunken px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}
