'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  properties as propertiesApi,
  users as usersApi,
  type Property,
} from '@/lib/api';
import { translations, type Locale } from '@/i18n/translations';
import { Building2, Check, Save, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Cleaner settings page — currently just lets cleaners pick which properties
 * they want to see in the pool view ("Cleanings").
 *
 * The selection is stored in user.preferences.cleaningsPoolFilter.propertyIds
 * via PATCH /users/:id. The backend reads the same key when filtering /pool.
 */
export default function CleanerSettingsPage() {
  const { user, setAuth, token } = useAuth();
  const locale = (user?.language as Locale) ?? 'en';
  const t = translations[locale];
  const ts = t.cleanerSettings;

  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Load properties + seed selection from current preferences
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await propertiesApi.list();
        if (cancelled) return;
        setAllProperties(list);

        const initial: string[] =
          user?.preferences?.cleaningsPoolFilter?.propertyIds ?? [];
        setSelected(new Set(initial));
      } catch (err: any) {
        setError(err?.message ?? t.general.error);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.preferences, t.general.error]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allProperties;
    const q = search.toLowerCase();
    return allProperties.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.address ?? '').toLowerCase().includes(q),
    );
  }, [allProperties, search]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectAll() {
    setSelected(new Set(allProperties.map((p) => p.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const updated = await usersApi.updateMyPreferences({
        ...(user.preferences ?? {}),
        cleaningsPoolFilter: { propertyIds: Array.from(selected) },
      });
      // Update local auth store so subsequent /pool requests use the new prefs
      if (token) {
        setAuth(token, { ...user, preferences: updated.preferences });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message ?? t.general.error);
    } finally {
      setSaving(false);
    }
  }

  const selCount = selected.size;
  const allCount = allProperties.length;

  return (
    <div className="min-h-screen bg-surface">
      <div className="bg-ink text-white px-4 pt-12 pb-6">
        <p className="text-white/60 text-sm font-medium">
          {user?.name?.split(' ')[0]}
        </p>
        <h1 className="text-xl font-bold mt-0.5">{ts.title}</h1>
      </div>

      <div className="p-4 max-w-2xl mx-auto -mt-3">
        <div className="bg-white rounded-2xl border border-surface-border p-5">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={16} className="text-ink-muted" />
            <h2 className="font-semibold text-ink">{ts.propertyPickerTitle}</h2>
          </div>
          <p className="text-xs text-ink-muted mb-4">{ts.propertyPickerHelp}</p>

          {/* Search + bulk actions */}
          <div className="flex flex-col gap-2 mb-3">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                type="text"
                placeholder={ts.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-surface-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">
                {ts.selectedCount(selCount, allCount)}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={selectAll}
                  className="text-accent font-medium hover:underline"
                >
                  {ts.selectAll}
                </button>
                <button
                  onClick={selectNone}
                  className="text-ink-muted font-medium hover:underline"
                >
                  {ts.selectNone}
                </button>
              </div>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-surface-sunken animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">
              {ts.noMatches}
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[55vh] overflow-y-auto -mr-1 pr-1">
              {filtered.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => toggle(p.id)}
                      className={cn(
                        'w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border transition',
                        checked
                          ? 'bg-accent/5 border-accent/30'
                          : 'bg-white border-surface-border hover:bg-surface-sunken',
                      )}
                    >
                      <span
                        className={cn(
                          'w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0',
                          checked
                            ? 'bg-accent border-accent text-white'
                            : 'border-surface-border bg-white',
                        )}
                      >
                        {checked && <Check size={12} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink truncate">
                          {p.name}
                        </p>
                        {p.address && (
                          <p className="text-xs text-ink-muted truncate">
                            {p.address}
                          </p>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Save bar */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-border">
            {error ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : (
              <p className="text-xs text-ink-muted">{ts.saveHint}</p>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? t.general.saving : saved ? ts.saved : t.general.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
