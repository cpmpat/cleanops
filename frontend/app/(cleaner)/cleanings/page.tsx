'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import {
  events as eventsApi,
  properties as propsApi,
  users as usersApi,
  ApiError,
  type CleaningEvent,
  type Property,
} from '@/lib/api';
import { CleaningCard } from '@/components/CleaningCard';
import { translations, type Locale } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { LogOut, Filter, X, Check } from 'lucide-react';

export default function CleaningsPoolPage() {
  const { user, logout, setAuth, token } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];

  const [pool, setPool] = useState<CleaningEvent[]>([]);
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Initialise filter from user preferences on first load
  useEffect(() => {
    const stored = user?.preferences?.cleaningsPoolFilter?.propertyIds;
    if (stored && stored.length > 0) {
      setSelectedPropIds(new Set(stored));
    }
  }, [user?.preferences]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [poolRes, propsRes] = await Promise.all([
        eventsApi.pool(),
        propsApi.list(),
      ]);
      setPool(poolRes);
      setAllProps(propsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.general.error);
    } finally {
      setLoading(false);
    }
  }, [t.general.error]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: refetch when anyone claims/drops/releases
  useSocket({
    'event:updated': () => load(),
    'event:cancelled': () => load(),
  });

  // Apply filter
  const visible = useMemo(() => {
    if (selectedPropIds.size === 0) return pool;
    return pool.filter((e) => selectedPropIds.has(e.propertyId));
  }, [pool, selectedPropIds]);

  // Group by day
  const grouped = useMemo(() => {
    const map = new Map<string, CleaningEvent[]>();
    for (const ev of visible) {
      const day = new Date(ev.timeSlot).toISOString().slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(ev);
      map.set(day, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  async function handleClaim(eventId: string) {
    setClaimingId(eventId);
    setError('');
    try {
      await eventsApi.claim(eventId);
      // Remove from visible pool immediately; the socket broadcast will refresh
      setPool((p) => p.filter((e) => e.id !== eventId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.pool.claimFailed);
    } finally {
      setClaimingId(null);
    }
  }

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
      setSavedState('saved');
      // Re-fetch pool with the new filter applied server-side
      load();
      setTimeout(() => setSavedState('idle'), 2000);
    } catch {
      setSavedState('idle');
    }
  }

  const greeting = user?.name ? `${t.greeting}, ${user.name.split(' ')[0]}` : t.greeting;

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-ink text-white px-4 pt-12 pb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-white/60 text-sm font-medium">{greeting}</p>
            <h1 className="text-xl font-bold mt-0.5">{t.pool.title}</h1>
            <p className="text-white/60 text-xs mt-1">{t.pool.subtitle}</p>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-white/60 hover:text-white transition text-xs py-1.5 px-2 rounded-lg hover:bg-white/10"
          >
            <LogOut size={14} />
            {t.general.logout}
          </button>
        </div>

        {/* Filter button */}
        <button
          onClick={() => setFilterOpen(true)}
          className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 text-xs font-medium transition"
        >
          <Filter size={12} />
          {selectedPropIds.size === 0
            ? t.pool.filterAll
            : t.pool.filterSelected(selectedPropIds.size)}
        </button>
      </div>

      {/* List */}
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
        ) : visible.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🧹</div>
            <p className="font-semibold text-ink">{t.pool.empty}</p>
            <p className="text-sm text-ink-muted mt-1">{t.pool.emptySub}</p>
          </div>
        ) : (
          grouped.map(([day, items]) => (
            <div key={day}>
              <p className="text-xl font-bold text-ink mt-1 mb-3 px-1">
                {formatDayHeader(day, locale)}
              </p>
              <div className="space-y-3">
                {items.map((event) => (
                  <CleaningCard
                    key={event.id}
                    event={event}
                    t={t}
                    mode="pool"
                    userId={user?.id}
                    onClaim={() => handleClaim(event.id)}
                    claiming={claimingId === event.id}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Filter sheet */}
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
              <h2 className="font-bold text-lg text-ink">{t.pool.filterBtn}</h2>
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
                        checked
                          ? 'bg-ink border-ink text-white'
                          : 'border-surface-border'
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
                {savedState === 'saving'
                  ? t.general.saving
                  : savedState === 'saved'
                  ? t.pool.saved
                  : t.pool.saveFilter}
              </button>
            </div>
          </div>

          <style jsx>{`
            @keyframes slideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

function formatDayHeader(day: string, locale: Locale): string {
  const date = new Date(day + 'T12:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayDate = new Date(date);
  dayDate.setHours(0, 0, 0, 0);

  const diff = (dayDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

  const t = translations[locale];
  if (diff === 0) return t.mine.today;
  if (diff === 1) {
    // "Tomorrow" — not in translations, fall back to formatted
  }

  return date.toLocaleDateString(
    locale === 'en' ? 'en-GB' : locale === 'cs' ? 'cs-CZ' : locale === 'ru' ? 'ru-RU' : 'uk-UA',
    { weekday: 'long', day: 'numeric', month: 'long' },
  );
}
