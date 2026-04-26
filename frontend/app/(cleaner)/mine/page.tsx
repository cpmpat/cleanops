'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import {
  events as eventsApi,
  ApiError,
  type CleaningEvent,
} from '@/lib/api';
import { CleaningCard } from '@/components/CleaningCard';
import { MarkDoneSheet } from '@/components/MarkDoneSheet';
import { translations, type Locale } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { LogOut, Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type RangeKey = 'today' | 'thisWeek' | 'thisMonth' | 'custom';

interface DateRange {
  from: Date;
  to: Date;
}

function getPresetRange(key: Exclude<RangeKey, 'custom'>): DateRange {
  const now = new Date();

  switch (key) {
    case 'today': {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(from.getDate() + 1);
      return { from, to };
    }
    case 'thisWeek': {
      const day = now.getDay(); // 0 = Sun
      const mondayOffset = (day + 6) % 7;
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      from.setDate(now.getDate() - mondayOffset);
      const to = new Date(from);
      to.setDate(from.getDate() + 7);
      return { from, to };
    }
    case 'thisMonth': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }
  }
}

/** Format a Date to YYYY-MM-DD for <input type="date"> values. */
function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function formatDayHeader(day: string, locale: Locale): string {
  const date = new Date(day + 'T12:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDate = new Date(date);
  dayDate.setHours(0, 0, 0, 0);

  const diff = Math.round(
    (dayDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  const t = translations[locale];
  if (diff === 0) return t.mine.today;

  const localeTag =
    locale === 'en' ? 'en-GB' :
    locale === 'cs' ? 'cs-CZ' :
    locale === 'ru' ? 'ru-RU' : 'uk-UA';

  return date.toLocaleDateString(localeTag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function groupByDay(events: CleaningEvent[]): [string, CleaningEvent[]][] {
  const map = new Map<string, CleaningEvent[]>();
  for (const ev of events) {
    const d = dayKey(ev.timeSlot);
    const arr = map.get(d) ?? [];
    arr.push(ev);
    map.set(d, arr);
  }
  return Array.from(map.entries());
}

export default function MinePage() {
  const { user, logout } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];

  const [rangeKey, setRangeKey] = useState<RangeKey>('thisWeek');
  const [customRange, setCustomRange] = useState<DateRange>(() =>
    getPresetRange('thisWeek'),
  );
  const [customPickerOpen, setCustomPickerOpen] = useState(false);

  const [items, setItems] = useState<CleaningEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [dropConfirm, setDropConfirm] = useState<CleaningEvent | null>(null);
  const [doneTarget, setDoneTarget] = useState<CleaningEvent | null>(null);

  const activeRange: DateRange = useMemo(() => {
    if (rangeKey === 'custom') return customRange;
    return getPresetRange(rangeKey);
  }, [rangeKey, customRange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await eventsApi.mine(
        activeRange.from.toISOString(),
        activeRange.to.toISOString(),
      );
      setItems(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setLoading(false);
    }
  }, [activeRange, t.general.error]);

  useEffect(() => {
    load();
  }, [load]);

  useSocket({
    'event:updated': () => load(),
    'event:cancelled': () => load(),
    'assignment:released': () => load(),
  });

  const { futureGrouped, pastGrouped } = useMemo(() => {
    const now = new Date();
    const future: CleaningEvent[] = [];
    const past: CleaningEvent[] = [];

    for (const e of items) {
      if (e.status === 'COMPLETED') {
        past.push(e);
      } else if (new Date(e.timeSlot) >= now) {
        future.push(e);
      } else {
        past.push(e);
      }
    }

    future.sort(
      (a, b) => new Date(a.timeSlot).getTime() - new Date(b.timeSlot).getTime(),
    );
    past.sort(
      (a, b) => new Date(b.timeSlot).getTime() - new Date(a.timeSlot).getTime(),
    );

    const futureGrouped = groupByDay(future).sort(([a], [b]) => a.localeCompare(b));
    const pastGrouped = groupByDay(past).sort(([a], [b]) => b.localeCompare(a));

    return { futureGrouped, pastGrouped };
  }, [items]);

  async function handleDrop(eventId: string) {
    setDropConfirm(null);
    setDroppingId(eventId);
    setError('');
    try {
      await eventsApi.drop(eventId);
      setItems((p) => p.filter((e) => e.id !== eventId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setDroppingId(null);
    }
  }

  function handleDoneSuccess(updated: CleaningEvent) {
    setItems((p) => p.map((e) => (e.id === updated.id ? updated : e)));
    setDoneTarget(null);
  }

  function pickPreset(key: Exclude<RangeKey, 'custom'>) {
    setRangeKey(key);
    setCustomPickerOpen(false);
  }

  function openCustomPicker() {
    // Seed the custom range from the current active one so the picker
    // starts with sensible defaults
    if (rangeKey !== 'custom') {
      setCustomRange(activeRange);
    }
    setCustomPickerOpen(true);
  }

  function applyCustomRange(from: string, to: string) {
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    toDate.setDate(toDate.getDate() + 1); // inclusive end day
    setCustomRange({ from: fromDate, to: toDate });
    setRangeKey('custom');
    setCustomPickerOpen(false);
  }

  const presets: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
    { key: 'today', label: t.mine.rangeToday },
    { key: 'thisWeek', label: t.mine.rangeThisWeek },
    { key: 'thisMonth', label: t.mine.rangeThisMonth },
  ];

  const customLabel =
    rangeKey === 'custom'
      ? `${toInputDate(activeRange.from)} → ${toInputDate(
          new Date(activeRange.to.getTime() - 1),
        )}`
      : t.mine.rangeCustom;

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-ink text-white px-4 pt-12 pb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-white/60 text-sm font-medium">
              {user?.name?.split(' ')[0]}
            </p>
            <h1 className="text-xl font-bold mt-0.5">{t.mine.title}</h1>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
          >
            <LogOut size={14} />
            {t.general.logout}
          </button>
        </div>

        {/* Range switcher */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {presets.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => pickPreset(key)}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition whitespace-nowrap',
                rangeKey === key
                  ? 'bg-white text-ink'
                  : 'bg-white/10 text-white/80 hover:bg-white/20',
              )}
            >
              {label}
            </button>
          ))}
          <button
            onClick={openCustomPicker}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition whitespace-nowrap',
              rangeKey === 'custom'
                ? 'bg-white text-ink'
                : 'bg-white/10 text-white/80 hover:bg-white/20',
            )}
          >
            <Calendar size={12} />
            {customLabel}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="px-4 py-4 space-y-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-surface-border h-32 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-red-500 mb-3">{error}</p>
            <button onClick={load} className="text-xs text-accent underline">
              {t.general.retry}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📋</div>
            <p className="font-semibold text-ink">{t.mine.empty}</p>
          </div>
        ) : (
          <>
            {futureGrouped.length > 0 && (
              <div className="space-y-5">
                <p className="text-xs font-bold text-ink uppercase tracking-wider px-1">
                  {t.mine.future}
                </p>
                {futureGrouped.map(([day, evs]) => (
                  <div key={'f-' + day}>
                    <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2 px-1">
                      {formatDayHeader(day, locale)}
                    </p>
                    <div className="space-y-3">
                      {evs.map((event) => (
                        <CleaningCard
                          key={event.id}
                          event={event}
                          t={t}
                          mode="mine"
                          userId={user?.id}
                          onDrop={() => setDropConfirm(event)}
                          onDone={() => setDoneTarget(event)}
                          dropping={droppingId === event.id}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pastGrouped.length > 0 && (
              <div className="space-y-5">
                <p className="text-xs font-bold text-ink uppercase tracking-wider px-1 pt-2">
                  {t.mine.past}
                </p>
                {pastGrouped.map(([day, evs]) => (
                  <div key={'p-' + day}>
                    <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2 px-1">
                      {formatDayHeader(day, locale)}
                    </p>
                    <div className="space-y-3">
                      {evs.map((event) => (
                        <CleaningCard
                          key={event.id}
                          event={event}
                          t={t}
                          mode="mine"
                          userId={user?.id}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Custom range picker */}
      {customPickerOpen && (
        <CustomRangePicker
          initial={activeRange}
          onClose={() => setCustomPickerOpen(false)}
          onApply={applyCustomRange}
          t={t}
        />
      )}

      {/* Drop confirmation */}
      {dropConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDropConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5"
          >
            <h2 className="font-bold text-ink mb-1">{t.mine.dropConfirmTitle}</h2>
            <p className="text-sm text-ink-muted mb-4">{t.mine.dropConfirmBody}</p>
            <p className="text-sm font-semibold text-ink bg-surface rounded-lg p-3 mb-4 truncate">
              {dropConfirm.accommodationName}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDropConfirm(null)}
                className="flex-1 px-4 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
              >
                {t.mine.dropConfirmNo}
              </button>
              <button
                onClick={() => handleDrop(dropConfirm.id)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition"
              >
                {t.mine.dropConfirmYes}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Done flow sheet */}
      {doneTarget && (
        <MarkDoneSheet
          event={doneTarget}
          t={t}
          onClose={() => setDoneTarget(null)}
          onSuccess={handleDoneSuccess}
        />
      )}
    </div>
  );
}

// ─── Custom range picker bottom sheet ─────────────────────────

interface CustomRangePickerProps {
  initial: DateRange;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
  t: ReturnType<typeof translations.en extends infer U ? () => U : never> extends never
    ? typeof translations.en
    : typeof translations.en;
}

function CustomRangePicker({
  initial,
  onClose,
  onApply,
  t,
}: {
  initial: DateRange;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
  t: typeof translations.en;
}) {
  // For the <input type="date"> value, we need YYYY-MM-DD.
  // The stored `to` is exclusive (midnight the day after), so subtract 1ms.
  const initialFrom = toInputDate(initial.from);
  const initialTo = toInputDate(new Date(initial.to.getTime() - 1));

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const valid = from && to && from <= to;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-t-3xl shadow-xl p-5 pb-safe animate-[slideUp_.2s_ease-out]"
      >
        <div className="w-12 h-1 rounded-full bg-surface-border mx-auto mb-4" />

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-lg text-ink">{t.mine.customPickerTitle}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              {t.mine.customFrom}
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              {t.mine.customTo}
            </label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
            >
              {t.general.cancel}
            </button>
            <button
              onClick={() => onApply(from, to)}
              disabled={!valid}
              className="flex-1 px-4 py-3 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.mine.customApply}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
