'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import {
  bookings as bookingsApi,
  properties as propsApi,
  users as usersApi,
  ApiError,
  type CalendarBooking,
  type Property,
} from '@/lib/api';
import { translations, type Locale } from '@/i18n/translations';
import type { Translations } from '@/i18n/translations';
import { ChevronLeft, ChevronRight, Filter, X, Check, LogOut } from 'lucide-react';

const WINDOW_DAYS = 10;

const LOCALE_TAG: Record<Locale, string> = {
  en: 'en-GB',
  cs: 'cs-CZ',
  ru: 'ru-RU',
  uk: 'uk-UA',
};

export default function CalendarPage() {
  const { user, logout, setAuth, token } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];
  const localeTag = LOCALE_TAG[locale];

  // Anchor = first day of the visible 10-day window, normalised to midnight local.
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfLocalDay(new Date()));

  const windowEnd = useMemo(() => addDays(anchorDate, WINDOW_DAYS), [anchorDate]);

  const days = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(anchorDate, i)),
    [anchorDate],
  );

  const [bookingsData, setBookingsData] = useState<CalendarBooking[]>([]);
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter sheet state (mirrors the cleanings page convention)
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Sync filter checkboxes with stored selection — same pattern as cleanings/page.tsx.
  useEffect(() => {
    const stored = user?.preferences?.cleaningsPoolFilter?.propertyIds ?? [];
    setSelectedPropIds(new Set(stored));
  }, [user?.preferences, filterOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [calRes, propsRes] = await Promise.all([
        bookingsApi.calendar(anchorDate.toISOString(), windowEnd.toISOString()),
        propsApi.list(),
      ]);
      setBookingsData(calRes.bookings);
      setPropertyIds(calRes.propertyIds);
      setAllProps(propsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setLoading(false);
    }
  }, [anchorDate, windowEnd, t.general.error]);

  useEffect(() => {
    load();
  }, [load]);

  function goPrev() {
    setAnchorDate((d) => addDays(d, -WINDOW_DAYS));
  }
  function goNext() {
    setAnchorDate((d) => addDays(d, WINDOW_DAYS));
  }
  function goToday() {
    setAnchorDate(startOfLocalDay(new Date()));
  }

  // Bookings grouped by property
  const byProperty = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const b of bookingsData) {
      const arr = map.get(b.propertyId) ?? [];
      arr.push(b);
      map.set(b.propertyId, arr);
    }
    return map;
  }, [bookingsData]);

  // Render order: properties in propertyIds (from backend, reflects stored filter),
  // sorted by their display name for stable ordering.
  const visibleProperties = useMemo(() => {
    const lookup = new Map(allProps.map((p) => [p.id, p]));
    return propertyIds
      .map((id) => lookup.get(id))
      .filter((p): p is Property => !!p)
      .sort((a, b) => a.name.localeCompare(b.name, localeTag));
  }, [propertyIds, allProps, localeTag]);

  const todayStart = startOfLocalDay(new Date()).getTime();
  const onTodayWindow = anchorDate.getTime() === todayStart;

  function togglePropFilter(id: string) {
    setSelectedPropIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSavedState('idle');
  }

  function clearFilter() {
    setSelectedPropIds(new Set());
    setSavedState('idle');
  }

  async function saveFilterAsDefault() {
    if (!user) return;
    setSavedState('saving');
    try {
      const updated = await usersApi.updateMyPreferences({
        ...(user.preferences ?? {}),
        cleaningsPoolFilter: { propertyIds: Array.from(selectedPropIds) },
      });
      if (token) setAuth(token, { ...user, preferences: updated.preferences });
      setFilterOpen(false);
      setSavedState('idle');
      load();
    } catch {
      setSavedState('idle');
    }
  }

  const greeting = user?.name ? `${t.greeting}, ${user.name.split(' ')[0]}` : t.greeting;

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-ink text-white px-4 pt-12 pb-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-white/60 text-sm font-medium">{greeting}</p>
            <h1 className="text-xl font-bold mt-0.5">{t.calendar.title}</h1>
            <p className="text-white/60 text-xs mt-1">
              {t.calendar.unitsSummary(propertyIds.length, allProps.length)}
            </p>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
          >
            <LogOut size={14} />
            {t.general.logout}
          </button>
        </div>

        <button
          onClick={() => setFilterOpen(true)}
          className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 text-xs font-medium transition"
        >
          <Filter size={12} />
          {t.calendar.filterUnits}
        </button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border bg-white">
        <button
          onClick={goPrev}
          aria-label="Previous"
          className="w-9 h-9 rounded-full border border-surface-border flex items-center justify-center hover:bg-surface-sunken transition active:scale-95"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-semibold text-sm text-ink">
          {formatWindowLabel(anchorDate, addDays(anchorDate, WINDOW_DAYS - 1), localeTag)}
        </span>
        <button
          onClick={goNext}
          aria-label="Next"
          className="w-9 h-9 rounded-full border border-surface-border flex items-center justify-center hover:bg-surface-sunken transition active:scale-95"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* "Back to today" pill when scrolled away */}
      {!onTodayWindow && (
        <div className="px-4 py-2 bg-white border-b border-surface-border flex justify-center">
          <button
            onClick={goToday}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent bg-accent-soft rounded-full px-3 py-1 hover:opacity-90 transition"
          >
            {t.calendar.backToToday}
          </button>
        </div>
      )}

      {/* Day strip — stays pinned to the top while scrolling unit rows
          so the date headers always align with the bars below. */}
      <div className="grid grid-cols-10 px-3 py-2.5 bg-surface-sunken border-b border-surface-border select-none sticky top-0 z-20">
        {days.map((d) => {
          const isTodayCell = startOfLocalDay(d).getTime() === todayStart;
          return (
            <div key={d.toISOString()} className="text-center">
              <div className="text-[10px] uppercase tracking-wide text-ink-faint leading-tight">
                {formatDayLetter(d, localeTag)}
              </div>
              <div
                className={`text-[13px] font-semibold leading-tight mt-0.5 inline-block min-w-[22px] ${
                  isTodayCell
                    ? 'text-white bg-amber-700 rounded-full px-1.5 py-px'
                    : 'text-ink'
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      {loading ? (
        <div className="px-3 py-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-surface-border h-20 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12 px-4">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          <button onClick={load} className="text-xs text-accent underline">
            {t.general.retry}
          </button>
        </div>
      ) : propertyIds.length === 0 ? (
        <div className="text-center py-16 px-6">
          <div className="text-5xl mb-4">📅</div>
          <p className="font-semibold text-ink">{t.calendar.noUnitsTitle}</p>
          <p className="text-sm text-ink-muted mt-1 mb-4">{t.calendar.noUnitsBody}</p>
          <button
            onClick={() => setFilterOpen(true)}
            className="inline-flex items-center gap-1.5 bg-ink text-white rounded-full px-4 py-2 text-sm font-semibold"
          >
            <Filter size={14} />
            {t.calendar.noUnitsCta}
          </button>
        </div>
      ) : (
        <div>
          {visibleProperties.map((prop) => (
            <UnitRow
              key={prop.id}
              property={prop}
              bookings={byProperty.get(prop.id) ?? []}
              days={days}
              localeTag={localeTag}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Filter sheet — mirrors cleanings page */}
      {filterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setFilterOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-t-3xl shadow-xl p-5 pb-safe max-h-[80vh] flex flex-col animate-[slideUp_.2s_ease-out]"
          >
            <div className="w-12 h-1 rounded-full bg-surface-border mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg text-ink">{t.calendar.filterUnits}</h2>
              <button
                onClick={() => setFilterOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
              {allProps.map((p) => {
                const checked = selectedPropIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => togglePropFilter(p.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition ${
                      checked ? 'bg-accent-soft' : 'hover:bg-surface-sunken'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        checked ? 'bg-ink border-ink text-white' : 'border-surface-border'
                      }`}
                    >
                      {checked && <Check size={12} strokeWidth={3} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">{p.name}</p>
                      {p.address && (
                        <p className="text-xs text-ink-muted truncate">{p.address}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="pt-4 flex gap-2">
              {selectedPropIds.size > 0 && (
                <button
                  onClick={clearFilter}
                  className="px-4 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
                >
                  {t.pool.clearFilter}
                </button>
              )}
              <button
                onClick={saveFilterAsDefault}
                disabled={savedState === 'saving'}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-60"
              >
                {savedState === 'saving' ? t.general.saving : t.pool.saveFilter}
              </button>
            </div>
          </div>
          <style jsx>{`
            @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
          `}</style>
        </div>
      )}
    </div>
  );
}

// ─── UnitRow ──────────────────────────────────────────────────────────────────

interface UnitRowProps {
  property: Property;
  bookings: CalendarBooking[];
  days: Date[];
  localeTag: string;
  t: Translations;
}

function UnitRow({ property, bookings, days, localeTag, t }: UnitRowProps) {
  // Compute, for each visible day, whether the unit is occupied by some booking.
  const occupiedByDay = days.map((d) =>
    bookings.some((b) => isBookingActiveOnDay(b, d)),
  );

  // Free-day label (first free range in the window)
  const label = computeMetaLabel(occupiedByDay, days, localeTag, t);

  // Booking bars positioned by window-relative start/end day index
  const bars = bookings
    .map((b) => computeBarPlacement(b, days))
    .filter((bar): bar is NonNullable<typeof bar> => bar !== null);

  return (
    <div className="px-3 py-3 border-b border-surface-border">
      <p className="text-sm font-semibold text-ink px-1">{property.name}</p>
      <p
        className={`text-[11px] px-1 mt-0.5 mb-2 ${
          label.tone === 'free' ? 'text-emerald-700' : 'text-ink-faint'
        }`}
      >
        {label.text}
      </p>
      <div
        className="relative grid grid-cols-10 h-[22px]"
        role="img"
        aria-label={`Bookings timeline for ${property.name}`}
      >
        {days.map((_, i) => (
          <div
            key={i}
            className={`border-r border-dashed border-surface-border/60 ${
              i === days.length - 1 ? 'border-r-0' : ''
            }`}
          />
        ))}
        {bars.map((bar, idx) => (
          <div
            key={`${bar.booking.id}-${idx}`}
            className="absolute top-1 bottom-1 bg-[#FFC645] text-ink rounded text-[10px] font-semibold flex items-center px-1.5 overflow-hidden whitespace-nowrap"
            style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
            title={`${bar.booking.guestFirstName ?? t.calendar.guestPlaceholder} · ${bar.booking.bookingRef}`}
          >
            {bar.booking.guestFirstName ?? t.calendar.guestPlaceholder}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isBookingActiveOnDay(b: CalendarBooking, day: Date): boolean {
  const dayStart = startOfLocalDay(day);
  const dayEnd = addDays(dayStart, 1);
  const checkIn = new Date(b.checkInTime);
  const checkOut = b.checkOutTime ? new Date(b.checkOutTime) : new Date(8640000000000000);
  return checkIn < dayEnd && checkOut > dayStart;
}

/** Position a booking bar within the visible window by start/end day index. */
function computeBarPlacement(
  booking: CalendarBooking,
  days: Date[],
): { booking: CalendarBooking; leftPct: number; widthPct: number } | null {
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < days.length; i++) {
    if (isBookingActiveOnDay(booking, days[i])) {
      if (startIdx === -1) startIdx = i;
      endIdx = i;
    }
  }
  if (startIdx === -1) return null;
  const pctPerDay = 100 / days.length;
  return {
    booking,
    leftPct: startIdx * pctPerDay,
    widthPct: (endIdx - startIdx + 1) * pctPerDay,
  };
}

/** Build the per-unit meta line — "Free 20 Jun", "Free 18 Jun — 22 Jun", or "Booked all week". */
function computeMetaLabel(
  occupiedByDay: boolean[],
  days: Date[],
  localeTag: string,
  t: Translations,
): { text: string; tone: 'free' | 'busy' } {
  // Find consecutive free ranges
  let firstFreeStart = -1;
  let firstFreeEnd = -1;
  for (let i = 0; i < occupiedByDay.length; i++) {
    if (!occupiedByDay[i]) {
      if (firstFreeStart === -1) {
        firstFreeStart = i;
        firstFreeEnd = i;
      } else if (i === firstFreeEnd + 1) {
        firstFreeEnd = i;
      } else {
        break; // gap in the free range — keep just the first contiguous range
      }
    } else if (firstFreeStart !== -1) {
      break;
    }
  }

  if (firstFreeStart === -1) {
    return { text: t.calendar.bookedAllWindow, tone: 'busy' };
  }

  const fromStr = formatShortDay(days[firstFreeStart], localeTag);
  if (firstFreeStart === firstFreeEnd) {
    return { text: t.calendar.freeOn(fromStr), tone: 'free' };
  }
  const toStr = formatShortDay(days[firstFreeEnd], localeTag);
  return { text: t.calendar.freeBetween(fromStr, toStr), tone: 'free' };
}

function formatDayLetter(d: Date, localeTag: string): string {
  return d.toLocaleDateString(localeTag, { weekday: 'short' });
}

function formatShortDay(d: Date, localeTag: string): string {
  return d.toLocaleDateString(localeTag, { day: 'numeric', month: 'short' });
}

function formatWindowLabel(from: Date, to: Date, localeTag: string): string {
  const fromStr = from.toLocaleDateString(localeTag, { day: 'numeric', month: 'short' });
  const toStr = to.toLocaleDateString(localeTag, { day: 'numeric', month: 'short' });
  return `${fromStr} — ${toStr}`;
}
