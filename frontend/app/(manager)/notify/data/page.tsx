'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Loader2, RefreshCw, Search, X, AlertCircle, ArrowRight, Sheet, PencilLine, EyeOff } from 'lucide-react';
import {
  dataNotifications as api,
  type DataChange,
  type DataChangesMeta,
  type DataChangesQuery,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Notifications → Data: who changed what in the CDM lists, when, from what to
 * what. App saves and sheet reloads alike. The server decides which lists and
 * fields this role is shown (notify matrix ∩ access matrix); every filter here
 * can only narrow that.
 */

const TZ = 'Europe/Prague';
const pragueDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const pragueTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
};

const PRESETS = [
  { label: 'Today', from: () => daysAgo(0) },
  { label: '7 days', from: () => daysAgo(6) },
  { label: '30 days', from: () => daysAgo(29) },
  { label: 'All', from: () => '' },
];

type Filters = Required<Pick<DataChangesQuery, 'dataset' | 'field' | 'actor' | 'from' | 'to'>> & {
  source: '' | 'app' | 'import';
};
const EMPTY: Filters = { dataset: '', field: '', actor: '', source: '', from: daysAgo(6), to: '' };

export default function DataNotificationsPage() {
  const [meta, setMeta] = useState<DataChangesMeta | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [actorDraft, setActorDraft] = useState('');
  const [items, setItems] = useState<DataChange[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => { api.meta().then(setMeta).catch(() => setMeta({ lists: [] })); }, []);

  const query = useCallback((f: Filters, cursor?: string): DataChangesQuery => ({
    dataset: f.dataset || undefined,
    field: f.field || undefined,
    actor: f.actor || undefined,
    source: f.source || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    cursor,
    limit: 200,
  }), []);

  const load = useCallback(async (f: Filters) => {
    setLoading(true); setError(null);
    try {
      const res = await api.feed(query(f));
      setItems(res.items); setNext(res.next);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load changes');
      setItems([]); setNext(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(filters); }, [filters, load]);

  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    try {
      const res = await api.feed(query(filters, next));
      setItems((prev) => [...prev, ...res.items]); setNext(res.next);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load more');
    } finally {
      setMore(false);
    }
  };

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const fieldsOfList = meta?.lists.find((l) => l.key === filters.dataset)?.fields ?? [];

  // Search narrows what is loaded: record, field, values, who.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) =>
      [c.record, c.fieldLabel, c.field, c.oldValue, c.newValue, c.actorEmail]
        .some((v) => v && v.toLowerCase().includes(q)));
  }, [items, search]);

  const byDay = useMemo(() => {
    const out: Array<{ day: string; rows: DataChange[] }> = [];
    for (const c of shown) {
      const day = pragueDay(c.createdAt);
      if (out.length === 0 || out[out.length - 1].day !== day) out.push({ day, rows: [] });
      out[out.length - 1].rows.push(c);
    }
    return out;
  }, [shown]);

  const activePreset = PRESETS.find((p) => p.from() === filters.from && !filters.to)?.label;
  const filtered = filters.dataset || filters.field || filters.actor || filters.source || filters.to;

  return (
    <div className="p-6 max-w-full">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Bell size={22} className="text-ink-muted" />
            Notifications <span className="text-ink-faint font-normal">/</span> Data
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            What changed in the CDM lists — who, when, from what to what. Edits saved in the app and reloads from the sheet.
          </p>
        </div>
        <button
          onClick={() => load(filters)}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border bg-surface text-sm font-semibold text-ink-muted hover:text-ink transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* ── filters ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Labelled label="List">
          <select
            value={filters.dataset}
            onChange={(e) => set({ dataset: e.target.value, field: '' })}
            className={selectCls}
          >
            <option value="">All lists</option>
            {meta?.lists.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </Labelled>
        <Labelled label="Field">
          <select
            value={filters.field}
            onChange={(e) => set({ field: e.target.value })}
            disabled={!filters.dataset}
            title={filters.dataset ? undefined : 'Pick a list first'}
            className={cn(selectCls, 'max-w-[240px]')}
          >
            <option value="">All fields</option>
            {fieldsOfList.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Labelled>
        <Labelled label="Source">
          <select value={filters.source} onChange={(e) => set({ source: e.target.value as Filters['source'] })} className={selectCls}>
            <option value="">App and sheet</option>
            <option value="app">Edited in the app</option>
            <option value="import">Sheet reloads</option>
          </select>
        </Labelled>
        <Labelled label="Who">
          <form
            onSubmit={(e) => { e.preventDefault(); set({ actor: actorDraft.trim() }); }}
            className="flex"
          >
            <input
              value={actorDraft}
              onChange={(e) => setActorDraft(e.target.value)}
              onBlur={() => actorDraft.trim() !== filters.actor && set({ actor: actorDraft.trim() })}
              placeholder="email contains…"
              className={cn(selectCls, 'w-44')}
            />
          </form>
        </Labelled>
        <Labelled label="Period">
          <div className="flex items-center gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => set({ from: p.from(), to: '' })}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition',
                  activePreset === p.label
                    ? 'bg-ink text-white border-ink'
                    : 'bg-surface border-surface-border text-ink-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
            <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={cn(selectCls, 'w-36')} />
            <span className="text-ink-faint text-xs">to</span>
            <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={cn(selectCls, 'w-36')} />
          </div>
        </Labelled>
        {filtered && (
          <button
            onClick={() => { setActorDraft(''); setFilters({ ...EMPTY, from: filters.from }); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink"
          >
            <X size={12} /> Clear filters
          </button>
        )}
        <div className="ml-auto relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search loaded changes"
            className={cn(selectCls, 'pl-8 w-64')}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* ── feed ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-surface-border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-sunken text-left text-xs font-semibold text-ink-muted">
                <th className="px-4 py-2.5 w-16">Time</th>
                <th className="px-4 py-2.5">Who</th>
                <th className="px-4 py-2.5">List</th>
                <th className="px-4 py-2.5">Record</th>
                <th className="px-4 py-2.5">Field</th>
                <th className="px-4 py-2.5">Change</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-muted"><Loader2 size={18} className="inline animate-spin" /></td></tr>
              )}
              {!loading && shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    {meta && meta.lists.length === 0
                      ? 'No list changes are shared with your role yet.'
                      : 'No changes in this period.'}
                  </td>
                </tr>
              )}
              {byDay.map(({ day, rows }) => (
                <DayGroup key={day} day={day} rows={rows} />
              ))}
            </tbody>
          </table>
        </div>
        {next && (
          <div className="border-t border-surface-border p-3 text-center">
            <button
              onClick={loadMore}
              disabled={more}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
            >
              {more && <Loader2 size={14} className="animate-spin" />} Load older changes
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {shown.length} change{shown.length === 1 ? '' : 's'} shown{search ? ` (of ${items.length} loaded)` : ''}. Times are Prague time.
      </p>
    </div>
  );
}

const selectCls =
  'px-3 py-1.5 rounded-lg border border-surface-border bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:opacity-50';

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function DayGroup({ day, rows }: { day: string; rows: DataChange[] }) {
  return (
    <>
      <tr>
        <td colSpan={6} className="px-4 pt-4 pb-1.5 text-xs font-semibold text-ink border-b border-surface-border bg-white">
          {dayLabel(day)} <span className="text-ink-faint font-normal">· {rows.length}</span>
        </td>
      </tr>
      {rows.map((c) => (
        <tr key={c.id} className="border-b border-surface-border/70 align-top hover:bg-surface-sunken/50">
          <td className="px-4 py-2 text-ink-muted tabular-nums whitespace-nowrap">{pragueTime(c.createdAt)}</td>
          <td className="px-4 py-2 whitespace-nowrap">
            {c.source === 'import' ? (
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <Sheet size={13} className="text-emerald-600" /> Sheet reload
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <PencilLine size={13} className="text-amber-600" />
                <span className="text-ink">{c.actorEmail ?? '—'}</span>
                {c.actorRole && (
                  <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                    {c.actorRole}
                  </span>
                )}
              </span>
            )}
          </td>
          <td className="px-4 py-2 text-ink-muted whitespace-nowrap">{c.listLabel}</td>
          <td className="px-4 py-2 text-ink max-w-[260px] truncate" title={c.record ?? c.rowId}>{c.record ?? <span className="text-ink-faint">deleted row</span>}</td>
          <td className="px-4 py-2 text-ink-muted whitespace-nowrap" title={c.field}>{c.fieldLabel}</td>
          <td className="px-4 py-2">
            {c.masked ? (
              <span className="inline-flex items-center gap-1.5 text-ink-muted italic">
                <EyeOff size={13} /> changed — value not recorded (sensitive)
              </span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Value v={c.oldValue} old />
                <ArrowRight size={12} className="text-ink-faint flex-shrink-0" />
                <Value v={c.newValue} />
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

function Value({ v, old }: { v: string | null; old?: boolean }) {
  if (v === null || v === '') return <span className="text-ink-faint italic">empty</span>;
  const long = v.length > 80;
  return (
    <span
      title={long ? v : undefined}
      className={cn(
        'rounded-md px-1.5 py-0.5 break-words',
        old ? 'bg-red-50 text-red-800 line-through decoration-red-300' : 'bg-emerald-50 text-emerald-900 font-medium',
      )}
    >
      {long ? `${v.slice(0, 80)}…` : v}
    </span>
  );
}
