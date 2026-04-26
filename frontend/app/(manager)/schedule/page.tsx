'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useEffect, useRef, useCallback } from 'react';
import { events as eventsApi, properties as propsApi, users as usersApi, type CleaningEvent, type Property, type User } from '@/lib/api';
import { EventDetailSheet } from '@/components/EventDetailSheet';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { todayISO, cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, RefreshCw, Calendar } from 'lucide-react';

// FullCalendar — loaded dynamically to avoid SSR issues
import dynamic from 'next/dynamic';

const FullCalendarComponent = dynamic(
  () => import('@/components/ScheduleCalendar'),
  { ssr: false, loading: () => <CalendarSkeleton /> }
);

export default function SchedulePage() {

  const { locale } = useLocale();
  const t = translations[locale];

  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // Monday
    return d.toISOString().split('T')[0];
  });

  const [events, setEvents] = useState<CleaningEvent[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [cleaners, setCleaners] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CleaningEvent | null>(null);

  // Compute week end (Sunday)
  const weekEnd = (() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [evts, props, users] = await Promise.all([
        eventsApi.byDateRange(weekStart, weekEnd + 'T23:59:59'),
        propsApi.list(),
        usersApi.list(),
      ]);
      setEvents(evts);
      setProperties(props);
      setCleaners(users.filter(u => u.role === 'CLEANER'));
    } catch {}
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  function shiftWeek(direction: 1 | -1) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + direction * 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }

  function goToThisWeek() {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    setWeekStart(d.toISOString().split('T')[0]);
  }

  const isThisWeek = weekStart === (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toISOString().split('T')[0];
  })();

  // Format week label
  const weekLabel = (() => {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    const monthStart = start.toLocaleString(locale, { month: 'short' });
    const monthEnd = end.toLocaleString(locale, { month: 'short' });
    if (monthStart === monthEnd) {
      return `${start.getDate()}–${end.getDate()} ${monthStart} ${start.getFullYear()}`;
    }
    return `${start.getDate()} ${monthStart} – ${end.getDate()} ${monthEnd} ${end.getFullYear()}`;
  })();

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-surface-border bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <Calendar size={20} className="text-ink-muted" />
            Schedule
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">Cleaning assignments by unit</p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 text-ink-muted hover:text-ink rounded-xl hover:bg-surface-sunken transition"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>

          <div className="flex items-center gap-1 bg-surface-sunken rounded-xl p-1">
            <button
              onClick={() => shiftWeek(-1)}
              className="p-1.5 rounded-lg hover:bg-white transition text-ink-muted hover:text-ink"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={goToThisWeek}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition',
                isThisWeek ? 'bg-ink text-white' : 'text-ink-muted hover:bg-white hover:text-ink'
              )}
            >
              This week
            </button>
            <button
              onClick={() => shiftWeek(1)}
              className="p-1.5 rounded-lg hover:bg-white transition text-ink-muted hover:text-ink"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="px-3 py-1.5 bg-white border border-surface-border rounded-xl text-sm font-medium text-ink min-w-[200px] text-center">
            {weekLabel}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 px-6 py-2 border-b border-surface-border bg-white flex items-center gap-4">
        {[
          { label: 'Pending', color: 'bg-amber-400' },
          { label: 'Assigned', color: 'bg-blue-500' },
          { label: 'In Progress', color: 'bg-violet-500' },
          { label: 'Completed', color: 'bg-emerald-500' },
          { label: 'Cancelled', color: 'bg-stone-300' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={cn('w-2.5 h-2.5 rounded-sm', color)} />
            <span className="text-xs text-ink-muted">{label}</span>
          </div>
        ))}
        <div className="ml-auto text-xs text-ink-faint">
          {events.length} cleanings this week
        </div>
      </div>

      {/* Calendar */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <CalendarSkeleton />
        ) : (
          <FullCalendarComponent
            weekStart={weekStart}
            events={events}
            properties={properties}
            cleaners={cleaners}
            onEventClick={(event) => setSelected(event)}
          />
        )}
      </div>

      {/* Event detail sheet */}
      {selected && (
        <EventDetailSheet
          event={selected}
          t={t}
          isManager
          onClose={() => setSelected(null)}
          onStatusChange={() => { load(); setSelected(null); }}
        />
      )}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="p-6 space-y-2 animate-pulse">
      {[1,2,3,4,5,6,7,8].map(i => (
        <div key={i} className="h-12 bg-surface-sunken rounded-xl" />
      ))}
    </div>
  );
}
