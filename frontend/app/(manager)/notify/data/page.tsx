'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, X, AlertCircle, EyeOff } from 'lucide-react';
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
 *
 * Oct 2026 redesign: When · Record · Field · Change · By, the old value struck
 * through and the new one tinted by what it means (live / off / neutral).
 */

const TZ = 'Europe/Prague';
const pragueDay = (iso: string | Date) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
const pragueTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayLabel = (day: string) => {
  if (day === pragueDay(new Date())) return 'Today';
  if (day === pragueDay(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
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

/** Columns: when · record · field · change · by — one grid for heading and rows. */
const GRID = 'grid grid-cols-[64px_minmax(220px,1.6fr)_170px_minmax(220px,1.4fr)_190px] gap-2.5 items-center';

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
    <div className="p-6 max-w-full flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">Records · Notifications</span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Data changes</h1>
          <p className="text-sm text-ink-muted">
            Every change to a list, with who made it — edits saved in the app and reloads from the sheet.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <label className="h-9 w-[240px] flex items-center gap-2 px-2.5 rounded-[10px] border border-surface-border bg-white">
            <Search size={13} className="text-ink-muted flex-shrink-0" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search unit, field or person"
              aria-label="Search changes"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-ink-muted"
            />
          </label>
          <button
            onClick={() => load(filters)}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-9 w-9 flex items-center justify-center rounded-[10px] border border-surface-border bg-white text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={filters.dataset}
          onChange={(e) => set({ dataset: e.target.value, field: '' })}
          aria-label="List"
          className={cn(chipCls, filters.dataset && chipOn)}
        >
          <option value="">List: all</option>
          {meta?.lists.map((l) => <option key={l.key} value={l.key}>List: {l.label}</option>)}
        </select>
        <select
          value={filters.field}
          onChange={(e) => set({ field: e.target.value })}
          disabled={!filters.dataset}
          title={filters.dataset ? undefined : 'Pick a list first'}
          aria-label="Field"
          className={cn(chipCls, 'max-w-[240px]', filters.field && chipOn)}
        >
          <option value="">Field: all</option>
          {fieldsOfList.map((f) => <option key={f.key} value={f.key}>Field: {f.label}</option>)}
        </select>
        <select
          value={filters.source}
          onChange={(e) => set({ source: e.target.value as Filters['source'] })}
          aria-label="Source"
          className={cn(chipCls, filters.source && chipOn)}
        >
          <option value="">App and sheet</option>
          <option value="app">Edited in the app</option>
          <option value="import">Sheet reloads</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); set({ actor: actorDraft.trim() }); }} className="flex">
          <input
            value={actorDraft}
            onChange={(e) => setActorDraft(e.target.value)}
            onBlur={() => actorDraft.trim() !== filters.actor && set({ actor: actorDraft.trim() })}
            placeholder="Who: email contains…"
            aria-label="Who"
            className={cn(chipCls, 'w-48', filters.actor && chipOn)}
          />
        </form>
        <span className="w-px h-6 bg-surface-border mx-1" />
        <div role="group" aria-label="Period" className="flex gap-1 bg-white border border-surface-border rounded-[10px] p-[3px]">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => set({ from: p.from(), to: '' })}
              className={cn('rounded-lg px-2.5 py-1 text-[12.5px] transition',
                activePreset === p.label ? 'bg-accent text-white font-semibold' : 'text-ink-soft hover:bg-surface-sunken')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" className={cn(chipCls, 'w-36')} />
        <span className="text-ink-faint text-xs">to</span>
        <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" className={cn(chipCls, 'w-36')} />
        {filtered && (
          <button
            onClick={() => { setActorDraft(''); setFilters({ ...EMPTY, from: filters.from }); }}
            className="h-9 flex items-center gap-1 px-2.5 text-[12.5px] font-semibold text-ink-muted hover:text-ink"
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* ── feed ────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-surface-border bg-white overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <div className="min-w-[960px]">
            <div className={cn(GRID, 'px-4 py-2.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted border-b border-[#EFEAE0]')}>
              <span>When</span><span>Record</span><span>Field</span><span>Change</span><span>By</span>
            </div>
            {loading && items.length === 0 && (
              <div className="px-4 py-10 text-center text-ink-muted"><Loader2 size={18} className="inline animate-spin" /></div>
            )}
            {!loading && shown.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">
                {meta && meta.lists.length === 0
                  ? 'No list changes are shared with your role yet.'
                  : 'No changes in this period.'}
              </p>
            )}
            {byDay.map(({ day, rows }) => (
              <DayGroup key={day} day={day} rows={rows} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap justify-between items-center gap-2 px-4 py-2.5 text-[11.5px] text-ink-muted">
          <span>
            {shown.length} change{shown.length === 1 ? '' : 's'} shown{search ? ` (of ${items.length} loaded)` : ''} · Prague time ·
            {' '}sheet reloads are marked <strong className="font-semibold text-ink-soft">Sheet</strong>, everything else names a person.
          </span>
          {next && (
            <button
              onClick={loadMore}
              disabled={more}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-accent text-white text-[12.5px] font-semibold hover:bg-accent-hover disabled:opacity-50"
            >
              {more && <Loader2 size={13} className="animate-spin" />} Load older changes
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

const chipCls =
  'h-9 px-3 rounded-[10px] border border-surface-border bg-white text-[13px] text-ink-soft focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50';
const chipOn = 'bg-accent-soft border-transparent text-accent font-semibold';

function DayGroup({ day, rows }: { day: string; rows: DataChange[] }) {
  return (
    <>
      <div className="px-4 pt-3.5 pb-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted border-b border-[#EFEAE0] bg-[#FBFAF6]">
        {dayLabel(day)} <span className="font-normal normal-case tracking-normal">· {rows.length}</span>
      </div>
      {rows.map((c) => (
        <div key={c.id} className={cn(GRID, 'px-4 py-2.5 border-b border-[#F3EFE7] hover:bg-[#FBFAF6]')}>
          <span className="font-mono text-[11.5px] text-ink-muted tabular-nums">{pragueTime(c.createdAt)}</span>
          <span className="min-w-0 flex flex-col">
            <span className="text-[13px] font-semibold text-ink truncate" title={c.record ?? c.rowId}>
              {c.record ?? <span className="text-ink-faint font-normal italic">deleted row</span>}
            </span>
            <span className="text-[11px] text-ink-muted truncate">{c.listLabel}</span>
          </span>
          <span className="text-[13px] text-ink-soft truncate" title={c.field}>{c.fieldLabel}</span>
          <span className="min-w-0">
            {c.masked ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted italic">
                <EyeOff size={13} /> changed — value not recorded (sensitive)
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <Value v={c.oldValue} old />
                <span aria-hidden className="text-[#8A8E88]">→</span>
                <Value v={c.newValue} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex items-center gap-2 text-[12.5px] text-ink-soft">
            {c.source === 'import' ? (
              <>
                <Initial text="S" cls="bg-[#EFEAE0] text-[#5B5446]" />
                <span>Sheet</span>
              </>
            ) : (
              <>
                <Initial text={(c.actorEmail ?? '?')[0].toUpperCase()} cls="bg-accent text-white" />
                <span className="truncate" title={c.actorEmail ?? undefined}>{c.actorEmail?.split('@')[0] ?? '—'}</span>
                {c.actorRole && (
                  <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted flex-shrink-0">{c.actorRole}</span>
                )}
              </>
            )}
          </span>
        </div>
      ))}
    </>
  );
}

function Initial({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={cn('w-[22px] h-[22px] rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0', cls)}>
      {text}
    </span>
  );
}

/** What a new value means, for its tint: going live / on = good, going off = bad. */
const GOOD = /^(true|yes|ano|live|online|active|aktivní|on|1)$/i;
const BAD = /^(false|no|ne|off|offline|inactive|neaktivní|delisted|0)$/i;

function Value({ v, old }: { v: string | null; old?: boolean }) {
  if (v === null || v === '') return <span className="text-[12px] text-ink-faint italic">empty</span>;
  const long = v.length > 80;
  const text = long ? `${v.slice(0, 80)}…` : v;
  if (old) {
    return (
      <span title={long ? v : undefined} className="rounded-md px-1.5 py-0.5 text-[12px] bg-[#F3F0E9] text-ink-muted line-through break-words">
        {text}
      </span>
    );
  }
  const tone = GOOD.test(v.trim()) ? 'bg-accent-soft text-accent'
    : BAD.test(v.trim()) ? 'bg-coral-soft text-coral-deep'
    : 'bg-[#EFEAE0] text-[#5B5446]';
  return (
    <span title={long ? v : undefined} className={cn('rounded-md px-1.5 py-0.5 text-[12px] font-semibold break-words', tone)}>
      {text}
    </span>
  );
}
