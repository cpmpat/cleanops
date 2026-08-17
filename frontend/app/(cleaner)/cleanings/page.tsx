'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import {
  turnovers as turnoversApi,
  properties as propsApi,
  users as usersApi,
  ApiError,
  type Turnover,
  type Property,
} from '@/lib/api';
import { TurnoverCard } from '@/components/TurnoverCard';
import { ManagerMessageBand } from '@/components/ManagerMessageBand';
import { translations, type Locale } from '@/i18n/translations';
import { useSocket } from '@/lib/socket';
import { LogOut, Filter, X, Check } from 'lucide-react';

export default function CleaningsPoolPage() {
  const { user, logout, setAuth, token } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];

  const [pool, setPool] = useState<Turnover[]>([]);
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [selectedPropIds, setSelectedPropIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Sync the filter checkboxes with the stored selection whenever:
  //   - preferences change (initial hydration, save, or layout-level /auth/me refresh)
  //   - the filter sheet opens (defensive — guarantees the checkboxes
  //     reflect the saved default every time she opens it)
  // No empty-guard, so clearing the saved filter is also reflected here.
  useEffect(() => {
    const stored = user?.preferences?.cleaningsPoolFilter?.propertyIds ?? [];
    setSelectedPropIds(new Set(stored));
  }, [user?.preferences, filterOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [poolRes, propsRes] = await Promise.all([
        turnoversApi.pool(),
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

  // Apply property filter
  const visible = useMemo(() => {
    if (selectedPropIds.size === 0) return pool;
    return pool.filter((t) => selectedPropIds.has(t.propertyId));
  }, [pool, selectedPropIds]);

  // Group by carry-forward date — turnovers from past dates float to today
  const grouped = useMemo(() => {
    const todayStr = todayLocalDate();
    const map = new Map<string, Turnover[]>();

    for (const turnover of visible) {
      const groupDate = getGroupDate(turnover, todayStr);
      const arr = map.get(groupDate) ?? [];
      arr.push(turnover);
      map.set(groupDate, arr);
    }

    // Sort entries by date ascending
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  async function handleClaim(turnoverId: string) {
    setClaimingId(turnoverId);
    setError('');
    try {
      await turnoversApi.claim(turnoverId);
      // Remove from visible pool immediately; the socket broadcast will refresh
      setPool((p) => p.filter((t) => t.id !== turnoverId));
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
      // Close immediately — the sheet disappearing IS the confirmation that
      // the save worked. No flash, no delay, nothing that can race.
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

      {/* Manager messages — sits between the header and the list, never
          inside it, so it can't be mistaken for a cleaning. */}
      <ManagerMessageBand locale={locale} />

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
                {items.map((turnover) => (
                  <TurnoverCard
                    key={turnover.id}
                    turnover={turnover}
                    t={t}
                    mode="pool"
                    userId={user?.id}
                    onClaim={() => handleClaim(turnover.id)}
                    claiming={claimingId === turnover.id}
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Today's date as YYYY-MM-DD in local time (Prague). */
function todayLocalDate(): string {
  const d = new Date();
  return formatLocalDate(d);
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Compute the day-group a turnover belongs to with carry-forward semantics:
 *   - If the natural date (availableFrom or dueBy) is in the past → today
 *   - Otherwise → the natural date itself
 */
function getGroupDate(turnover: Turnover, todayStr: string): string {
  const candidateIso = turnover.availableFrom ?? turnover.dueBy;
  if (!candidateIso) return todayStr;

  const candidateDate = new Date(candidateIso);
  const candidateStr = formatLocalDate(candidateDate);

  return candidateStr < todayStr ? todayStr : candidateStr;
}

function formatDayHeader(day: string, locale: Locale): string {
  const date = new Date(day + 'T12:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDate = new Date(date);
  dayDate.setHours(0, 0, 0, 0);

  const diff = (dayDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

  const t = translations[locale];
  if (diff === 0) return t.mine.today;

  return date.toLocaleDateString(
    locale === 'en' ? 'en-GB' : locale === 'cs' ? 'cs-CZ' : locale === 'ru' ? 'ru-RU' : 'uk-UA',
    { weekday: 'long', day: 'numeric', month: 'long' },
  );
}
