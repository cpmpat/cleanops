'use client';
import { useLocale } from '@/lib/locale-context';
import { useState, useEffect } from 'react';
import { properties as propsApi, users as usersApi, type Property, type User } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translations, type Locale } from '@/i18n/translations';
import { Building2, Search, ChevronDown, Check, MapPin } from 'lucide-react';

export default function PropertiesPage() {
  const { locale } = useLocale();
  const t = translations[locale];

  const [props, setProps] = useState<Property[]>([]);
  const [cleaners, setCleaners] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  /** Local edits for the standing note, keyed by property id. */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([propsApi.list(), usersApi.list()])
      .then(([p, u]) => {
        setProps(p);
        setCleaners(u.filter(u => u.role === 'CLEANER'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /**
   * The standing note shown under the unit name on every cleaner card.
   * Keep it to one short sentence — keys, a quirk, where the bins are.
   */
  async function handleSaveNote(propertyId: string, value: string) {
    const current = props.find(p => p.id === propertyId)?.notes ?? '';
    const next = value.trim();
    if (next === current.trim()) return;

    setSavingId(propertyId);
    try {
      await propsApi.update(propertyId, { notes: next || null } as any);
      setProps(prev => prev.map(p => (p.id === propertyId ? { ...p, notes: next || null } : p)));
      setSavedId(propertyId);
      setTimeout(() => setSavedId(null), 2000);
    } catch {}
    finally { setSavingId(null); }
  }

  async function handleSetDefaultCleaner(propertyId: string, cleanerId: string) {
    setSavingId(propertyId);
    try {
      await propsApi.update(propertyId, { defaultCleanerId: cleanerId || undefined });
      setProps(prev => prev.map(p =>
        p.id === propertyId ? { ...p, defaultCleanerId: cleanerId || undefined } : p
      ));
      setSavedId(propertyId);
      setTimeout(() => setSavedId(null), 2000);
    } catch {}
    finally { setSavingId(null); }
  }

  const filtered = props.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.address?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t.nav.properties}</h1>
          <p className="text-sm text-ink-muted mt-0.5">{props.length} units synced from Avantio</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          placeholder="Search by unit name or address..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-surface-border bg-white focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-white rounded-2xl border border-surface-border animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <Building2 size={32} className="mx-auto text-ink-faint mb-3" />
          <p className="text-sm text-ink-muted">No properties found</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden divide-y divide-surface-border">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_260px_200px_32px] gap-4 px-5 py-2.5 bg-surface-sunken">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Unit</p>
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Note on the card</p>
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Default cleaner</p>
            <div />
          </div>

          {filtered.map(p => {
            const isSaving = savingId === p.id;
            const isSaved = savedId === p.id;

            return (
              <div key={p.id} className="grid grid-cols-[1fr_260px_200px_32px] gap-4 items-center px-5 py-3.5 hover:bg-surface-sunken transition">
                {/* Name + address */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.address && (
                      <p className="text-xs text-ink-muted flex items-center gap-1 truncate">
                        <MapPin size={10} className="flex-shrink-0" />
                        {p.address}
                      </p>
                    )}
                    {p.pmsPropertyId && (
                      <span className="text-[10px] text-ink-faint font-mono flex-shrink-0">#{p.pmsPropertyId}</span>
                    )}
                  </div>
                </div>

                {/* Standing note — lands under the unit name on the cleaner card */}
                <input
                  type="text"
                  value={noteDrafts[p.id] ?? p.notes ?? ''}
                  onChange={e => setNoteDrafts({ ...noteDrafts, [p.id]: e.target.value })}
                  onBlur={e => handleSaveNote(p.id, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="Keys in the lockbox, code 4512."
                  maxLength={160}
                  className="w-full text-sm px-3 py-1.5 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
                />

                {/* Default cleaner dropdown */}
                <div className="relative">
                  <select
                    value={p.defaultCleanerId ?? ''}
                    onChange={e => handleSetDefaultCleaner(p.id, e.target.value)}
                    disabled={isSaving}
                    className="w-full text-sm pl-3 pr-8 py-1.5 rounded-xl border border-surface-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent appearance-none disabled:opacity-50"
                  >
                    <option value="">No default</option>
                    {cleaners.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                </div>

                {/* Save indicator */}
                <div className="w-8 h-8 flex items-center justify-center">
                  {isSaving && (
                    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  )}
                  {isSaved && <Check size={16} className="text-emerald-500" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
