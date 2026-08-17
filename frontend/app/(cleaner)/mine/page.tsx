'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import {
  turnovers as turnoversApi,
  properties as propertiesApi,
  ApiError,
  type Turnover,
  type Property,
  type TurnoverStats,
} from '@/lib/api';
import { TurnoverCard } from '@/components/TurnoverCard';
import { HelpLink } from '@/components/HelpLink';
import { TurnoverMarkDoneSheet } from '@/components/TurnoverMarkDoneSheet';
import { translations, type Locale } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { LogOut, Calendar, X, Check } from 'lucide-react';
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
      const day = now.getDay();
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

function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the grouping date for a turnover. Uses availableFrom if set, else
 * dueBy. For carry-forward in the active list, past dates float to today.
 */
function groupingDateKey(tv: Turnover, carryForward: boolean): string {
  const base = tv.availableFrom ?? tv.dueBy ?? tv.createdAt;
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  let target = d;
  if (carryForward) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) target = today;
  }
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function groupByDay(items: Turnover[], carryForward: boolean): [string, Turnover[]][] {
  const map = new Map<string, Turnover[]>();
  for (const tv of items) {
    const day = groupingDateKey(tv, carryForward);
    const arr = map.get(day) ?? [];
    arr.push(tv);
    map.set(day, arr);
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

  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [propertyFilter, setPropertyFilter] = useState<string[]>([]);

  const [items, setItems] = useState<Turnover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [dropConfirm, setDropConfirm] = useState<Turnover | null>(null);
  const [doneTarget, setDoneTarget] = useState<Turnover | null>(null);
  const [stats, setStats] = useState<TurnoverStats | null>(null);

  useEffect(() => {
    propertiesApi
      .list()
      .then(setAllProperties)
      .catch(() => {});
  }, []);

  const activeRange: DateRange = useMemo(() => {
    if (rangeKey === 'custom') return customRange;
    return getPresetRange(rangeKey);
  }, [rangeKey, customRange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ids =
        rangeKey === 'custom' && propertyFilter.length > 0
          ? propertyFilter
          : undefined;
      const res = await turnoversApi.mine(
        activeRange.from.toISOString(),
        activeRange.to.toISOString(),
        ids,
      );
      setItems(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setLoading(false);
    }
  }, [activeRange, propertyFilter, rangeKey, t.general.error]);

  // Stats are independent of the range selector and must never break the page:
  // a failed fetch just leaves the segment hidden (the render is guarded with `stats &&`).
  const loadStats = useCallback(() => {
    turnoversApi
      .myStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useSocket({
    'event:updated': () => {
      load();
      loadStats();
    },
    'event:cancelled': () => {
      load();
      loadStats();
    },
    'assignment:released': () => {
      load();
      loadStats();
    },
  });

  const { futureGrouped, pastGrouped } = useMemo(() => {
    const now = new Date();
    const future: Turnover[] = [];
    const past: Turnover[] = [];

    for (const tv of items) {
      if (tv.status === 'COMPLETED' || tv.status === 'CANCELLED') {
        past.push(tv);
      } else {
        // Everything else (including overdue ASSIGNED) → future,
        // carry-forward grouping will float them to "Today"
        future.push(tv);
      }
    }

    // Future: earliest dueBy first; carry-forward applied
    future.sort((a, b) => {
      const aKey = a.dueBy ?? a.availableFrom ?? a.createdAt;
      const bKey = b.dueBy ?? b.availableFrom ?? b.createdAt;
      return new Date(aKey).getTime() - new Date(bKey).getTime();
    });
    // Past: most recent first (by completedAt or dueBy)
    past.sort((a, b) => {
      const aKey = a.completedAt ?? a.dueBy ?? a.availableFrom ?? a.createdAt;
      const bKey = b.completedAt ?? b.dueBy ?? b.availableFrom ?? b.createdAt;
      return new Date(bKey).getTime() - new Date(aKey).getTime();
    });

    const futureGrouped = groupByDay(future, true).sort(([a], [b]) => a.localeCompare(b));
    const pastGrouped = groupByDay(past, false).sort(([a], [b]) => b.localeCompare(a));

    return { futureGrouped, pastGrouped };
  }, [items]);

  async function handleDrop(turnoverId: string) {
    setDropConfirm(null);
    setDroppingId(turnoverId);
    setError('');
    try {
      await turnoversApi.drop(turnoverId);
      setItems((p) => p.filter((tv) => tv.id !== turnoverId));
      loadStats();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setDroppingId(null);
    }
  }

  async function handleStart(turnoverId: string) {
    setStartingId(turnoverId);
    setError('');
    try {
      const { turnover } = await turnoversApi.start(turnoverId);
      // Replace the row in-place so the card re-renders with startedAt set
      // and the button swaps from Start → Done.
      setItems((p) => p.map((tv) => (tv.id === turnoverId ? turnover : tv)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setStartingId(null);
    }
  }

  function handleDoneSuccess(updated: Turnover) {
    setItems((p) => p.map((tv) => (tv.id === updated.id ? updated : tv)));
    setDoneTarget(null);
    loadStats();
  }

  function pickPreset(key: Exclude<RangeKey, 'custom'>) {
    setRangeKey(key);
    setCustomPickerOpen(false);
  }

  function openCustomPicker() {
    if (rangeKey !== 'custom') {
      setCustomRange(activeRange);
    }
    setCustomPickerOpen(true);
  }

  function applyCustomRange(from: string, to: string, propertyIds: string[]) {
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    toDate.setDate(toDate.getDate() + 1);
    setCustomRange({ from: fromDate, to: toDate });
    setPropertyFilter(propertyIds);
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
      ? `${toInputDate(activeRange.from)} – ${toInputDate(new Date(activeRange.to.getTime() - 1))}`
      : t.mine.rangeCustom;

  return (
    <div className="min-h-screen bg-surface">
      <div className="bg-ink text-white px-4 pt-12 pb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold mt-0.5">{t.mine.title}</h1>
          </div>
          {/* Odhlásit + Nápověda pod ním */}
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
            >
              <LogOut size={14} />
              {t.general.logout}
            </button>
            <HelpLink locale={locale} />
          </div>
        </div>

        {/* Range picker chips */}
        <div className="flex gap-2 flex-wrap">
          {presets.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => pickPreset(key)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium transition',
                rangeKey === key
                  ? 'bg-white text-ink'
                  : 'bg-white/10 hover:bg-white/20 text-white',
              )}
            >
              {label}
            </button>
          ))}
          <button
            onClick={openCustomPicker}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
              rangeKey === 'custom'
                ? 'bg-white text-ink'
                : 'bg-white/10 hover:bg-white/20 text-white',
            )}
          >
            <Calendar size={12} />
            {customLabel}
          </button>
        </div>

        {/* Cleaner stats — blends into the dark header, but stands out as data */}
        {stats && (
          <div className="mt-5 pt-4 border-t border-white/10">
            <div className="flex items-end justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {t.mine.stats.id}
                </p>
                <p className="text-sm font-mono font-semibold text-white/90 truncate mt-0.5">
                  {stats.cdmUserId ?? '—'}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {t.mine.stats.todayRatio}
                </p>
                <p className="text-2xl font-bold leading-none mt-0.5 tabular-nums">
                  <span className="text-accent">{stats.todayDone}</span>
                  <span className="text-white/40">/{stats.todayAssigned}</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/10 px-3 py-2.5">
                <p className="text-xl font-bold leading-none text-white tabular-nums">
                  {stats.doneThisMonth}
                </p>
                <p className="text-[11px] text-white/50 mt-1.5 leading-tight">
                  {t.mine.stats.doneThisMonth}
                </p>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2.5">
                <p className="text-xl font-bold leading-none text-white tabular-nums">
                  {stats.assignedNotDone}
                </p>
                <p className="text-[11px] text-white/50 mt-1.5 leading-tight">
                  {t.mine.stats.assignedNotDone}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
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
              <div className="space-y-4">
                {futureGrouped.map(([day, list]) => (
                  <div key={day}>
                    <p className="text-xl font-bold text-ink mt-1 mb-3 px-1">
                      {formatDayHeader(day, locale)}
                    </p>
                    <div className="space-y-3">
                      {list.map((tv) => (
                        <TurnoverCard
                          key={tv.id}
                          turnover={tv}
                          t={t}
                          locale={locale}
                          mode="mine"
                          userId={user?.id}
                          onDrop={() => setDropConfirm(tv)}
                          onStart={() => handleStart(tv.id)}
                          onDone={() => {
                            console.log('DONE TAPPED', tv.id, 'currentDoneTarget:', !!doneTarget);
                            setDoneTarget(tv);
                          }}
                          dropping={droppingId === tv.id}
                          starting={startingId === tv.id}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pastGrouped.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-surface-border">
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider px-1">
                  {t.mine.past}
                </p>
                {pastGrouped.map(([day, list]) => (
                  <div key={day}>
                    <p className="text-xl font-bold text-ink mt-1 mb-3 px-1">
                      {formatDayHeader(day, locale)}
                    </p>
                    <div className="space-y-3">
                      {list.map((tv) => (
                        <TurnoverCard
                          key={tv.id}
                          turnover={tv}
                          t={t}
                          locale={locale}
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

      {customPickerOpen && (
        <CustomRangePicker
          initial={activeRange}
          initialPropertyIds={propertyFilter}
          allProperties={allProperties}
          onClose={() => setCustomPickerOpen(false)}
          onApply={applyCustomRange}
          t={t}
        />
      )}

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
              {dropConfirm.property?.name ?? dropConfirm.toBooking?.accommodationName ?? '—'}
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

      {doneTarget && (
        <TurnoverMarkDoneSheet
          turnover={doneTarget}
          t={t}
          onClose={() => setDoneTarget(null)}
          onSuccess={handleDoneSuccess}
        />
      )}
    </div>
  );
}

// ─── Custom range picker bottom sheet ─────────────────────────

function CustomRangePicker({
  initial,
  initialPropertyIds,
  allProperties,
  onClose,
  onApply,
  t,
}: {
  initial: DateRange;
  initialPropertyIds: string[];
  allProperties: Property[];
  onClose: () => void;
  onApply: (from: string, to: string, propertyIds: string[]) => void;
  t: typeof translations.en;
}) {
  const initialFrom = toInputDate(initial.from);
  const initialTo = toInputDate(new Date(initial.to.getTime() - 1));

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialPropertyIds),
  );

  const valid = from && to && from <= to;

  function toggleProperty(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function pickAll() {
    setSelected(new Set(allProperties.map((p) => p.id)));
  }

  function pickNone() {
    setSelected(new Set());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-t-3xl shadow-xl p-5 pb-safe animate-[slideUp_.2s_ease-out] max-h-[90vh] overflow-y-auto"
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

          {allProperties.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  {t.mine.customProperties}
                </label>
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={pickAll}
                    className="text-accent font-medium hover:underline"
                  >
                    {t.mine.customPropertiesAll}
                  </button>
                  <button
                    onClick={pickNone}
                    className="text-ink-muted font-medium hover:underline"
                  >
                    {t.mine.customPropertiesNone}
                  </button>
                </div>
              </div>
              <p className="text-xs text-ink-muted mb-2">
                {t.mine.customPropertiesHelp}
              </p>
              <ul className="space-y-1 max-h-48 overflow-y-auto -mr-1 pr-1">
                {allProperties.map((p) => {
                  const checked = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => toggleProperty(p.id)}
                        className={cn(
                          'w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border transition text-sm',
                          checked
                            ? 'bg-accent/5 border-accent/30'
                            : 'bg-white border-surface-border hover:bg-surface-sunken',
                        )}
                      >
                        <span
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                            checked
                              ? 'bg-accent border-accent text-white'
                              : 'border-surface-border bg-white',
                          )}
                        >
                          {checked && <Check size={10} strokeWidth={3} />}
                        </span>
                        <span className="truncate text-ink">{p.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
            >
              {t.general.cancel}
            </button>
            <button
              onClick={() => onApply(from, to, Array.from(selected))}
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
