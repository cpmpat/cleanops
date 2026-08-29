'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Database, RefreshCw, Search, Columns3, Filter, Pin, PinOff, X, AlertCircle, Check,
} from 'lucide-react';
import { datasets as api, type DatasetSummary, type DatasetPage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Pinned columns get a fixed width so their left offsets are computable. */
const PINNED_WIDTH = 190;

/**
 * Read-only viewer over the tenant's CDM spreadsheet.
 *
 * The Accommodation tab is ~140 columns wide, which rules out a plain table:
 * everything after the tenth column is off-screen, and whichever column
 * identifies the row scrolls away with it. Hence pinning, a column picker and
 * per-column row filters. Column labels and the descriptions shown on hover
 * come from the sheet's own mapping<Tab> tab, so the vocabulary is the
 * operator's rather than the database's.
 */
export default function DatasetsPage() {
  const [tabs, setTabs] = useState<DatasetSummary[]>([]);
  const [active, setActive] = useState<string>('');
  const [data, setData] = useState<DatasetPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<string[]>([]);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});

  const [panel, setPanel] = useState<'columns' | 'rows' | null>(null);
  const [filterColumn, setFilterColumn] = useState<string>('');
  const [columnSearch, setColumnSearch] = useState('');
  const [valueSearch, setValueSearch] = useState('');

  useEffect(() => {
    api.list()
      .then(list => {
        setTabs(list);
        if (list.length) setActive(list[0].key);
      })
      .catch(() => setError('Could not load the dataset list.'));
  }, []);

  const load = useCallback(async (key: string, refresh = false) => {
    if (!key) return;
    setLoading(true);
    setError('');
    try {
      const page = await api.read(key, refresh);
      setData(page);
      // Start from the sheet's own opinion about what is worth showing.
      setHidden(new Set(page.columns.filter(c => c.hiddenByDefault).map(c => c.key)));
      setPinned(page.columns.length ? [page.columns[0].key] : []);
      setFilters({});
      setFilterColumn('');
    } catch (e: any) {
      setData(null);
      setError(e?.message || 'Could not read this dataset.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(active); }, [active, load]);

  /** Pinned first, in the order they were pinned; then the rest, sheet order. */
  const visible = useMemo(() => {
    if (!data) return [];
    const withIndex = data.columns.map((c, i) => ({ ...c, i }));
    const shown = withIndex.filter(c => !hidden.has(c.key));
    const pins = pinned
      .map(k => shown.find(c => c.key === k))
      .filter(Boolean) as typeof shown;
    const rest = shown.filter(c => !pinned.includes(c.key));
    return [...pins, ...rest];
  }, [data, hidden, pinned]);

  /** Distinct values of the column being filtered, for the tick list. */
  const filterValues = useMemo(() => {
    if (!data || !filterColumn) return [];
    const idx = data.columns.findIndex(c => c.key === filterColumn);
    if (idx < 0) return [];
    const counts = new Map<string, number>();
    for (const row of data.rows) {
      const v = row[idx] ?? '';
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : a.value.localeCompare(b.value)));
  }, [data, filterColumn]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters).filter(([, set]) => set.size > 0);

    return data.rows.filter(row => {
      for (const [key, allowed] of active) {
        const idx = data.columns.findIndex(c => c.key === key);
        if (idx >= 0 && !allowed.has(row[idx] ?? '')) return false;
      }
      if (!q) return true;
      return row.some(cell => cell?.toLowerCase().includes(q));
    });
  }, [data, search, filters]);

  const activeFilterCount = Object.values(filters).filter(s => s.size > 0).length;

  function toggleFilterValue(column: string, value: string) {
    setFilters(prev => {
      const next = { ...prev };
      const set = new Set(next[column] ?? []);
      set.has(value) ? set.delete(value) : set.add(value);
      if (set.size === 0) delete next[column];
      else next[column] = set;
      return next;
    });
  }

  function togglePin(key: string) {
    setPinned(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  }

  const labelFor = (key: string) =>
    data?.columns.find(c => c.key === key)?.label ?? key;

  return (
    // Bottom padding leaves room for the tab bar pinned to the viewport floor.
    <div className="p-6 pb-24 max-w-full">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Database size={22} className="text-ink-muted" />
            Datasets
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Read-only view of the CDM spreadsheet. Changes made in the sheet appear here.
          </p>
        </div>
        <button
          onClick={() => load(active, true)}
          disabled={loading || !active}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border bg-surface text-sm font-semibold text-ink-muted hover:text-ink transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <PanelButton
          icon={<Columns3 size={14} />}
          label="Columns"
          badge={data ? `${visible.length}/${data.columns.length}` : undefined}
          open={panel === 'columns'}
          onClick={() => setPanel(p => (p === 'columns' ? null : 'columns'))}
        />
        <PanelButton
          icon={<Filter size={14} />}
          label="Rows"
          badge={activeFilterCount ? String(activeFilterCount) : undefined}
          open={panel === 'rows'}
          onClick={() => setPanel(p => (p === 'rows' ? null : 'rows'))}
        />

        {data && (
          <p className="text-xs text-ink-faint ml-auto">
            {rows.length.toLocaleString()} of {data.rows.length.toLocaleString()} rows
            {data.cached && ' · cached'}
          </p>
        )}
      </div>

      {/* Active filter chips — visible without opening the panel, and each one
          removable, so a filtered view can never be mistaken for a full one. */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {Object.entries(filters).map(([key, set]) => (
            <button
              key={key}
              onClick={() => setFilters(prev => { const n = { ...prev }; delete n[key]; return n; })}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent-soft border border-accent/30 text-[11px] font-medium text-ink"
            >
              {labelFor(key)}: {set.size} selected
              <X size={11} />
            </button>
          ))}
          <button onClick={() => setFilters({})} className="text-[11px] text-ink-muted hover:text-ink px-1.5">
            Clear all
          </button>
        </div>
      )}

      {panel === 'columns' && data && (
        <div className="mb-3 p-3 rounded-xl border border-surface-border bg-surface">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Show columns</p>
            <input
              value={columnSearch}
              onChange={e => setColumnSearch(e.target.value)}
              placeholder="Find a column…"
              className="ml-auto px-2.5 py-1 rounded-lg border border-surface-border text-xs w-48 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button onClick={() => setHidden(new Set())} className="text-xs text-accent font-semibold whitespace-nowrap">
              Show all
            </button>
          </div>
          <p className="text-[11px] text-ink-faint mb-2">
            Hover a column for its description. The pin keeps it in view while you scroll sideways.
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
            {data.columns
              .filter(c => !columnSearch ||
                c.label.toLowerCase().includes(columnSearch.toLowerCase()) ||
                c.key.toLowerCase().includes(columnSearch.toLowerCase()))
              .map(c => (
                <span
                  key={c.key}
                  title={c.description || c.key}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-lg text-[11px] border transition',
                    hidden.has(c.key)
                      ? 'bg-surface border-surface-border text-ink-faint'
                      : 'bg-white border-surface-border text-ink',
                  )}
                >
                  <button
                    onClick={() => setHidden(prev => {
                      const next = new Set(prev);
                      next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                      return next;
                    })}
                    className={cn('pl-2 py-1', hidden.has(c.key) && 'line-through')}
                  >
                    {c.label}
                  </button>
                  <button
                    onClick={() => togglePin(c.key)}
                    title={pinned.includes(c.key) ? 'Unfreeze this column' : 'Freeze this column'}
                    className={cn(
                      'pr-2 pl-0.5 py-1',
                      pinned.includes(c.key) ? 'text-accent' : 'text-ink-faint hover:text-ink-muted',
                    )}
                  >
                    {pinned.includes(c.key) ? <Pin size={11} /> : <PinOff size={11} />}
                  </button>
                </span>
              ))}
          </div>
        </div>
      )}

      {panel === 'rows' && data && (
        <div className="mb-3 p-3 rounded-xl border border-surface-border bg-surface">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Filter rows</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <input
                value={columnSearch}
                onChange={e => setColumnSearch(e.target.value)}
                placeholder="Find a column…"
                className="w-full px-2.5 py-1.5 rounded-lg border border-surface-border text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                {data.columns
                  .filter(c => !columnSearch ||
                    c.label.toLowerCase().includes(columnSearch.toLowerCase()) ||
                    c.key.toLowerCase().includes(columnSearch.toLowerCase()))
                  .map(c => (
                    <button
                      key={c.key}
                      title={c.description || c.key}
                      onClick={() => { setFilterColumn(c.key); setValueSearch(''); }}
                      className={cn(
                        'flex items-center justify-between text-left px-2 py-1 rounded-lg text-[11px] transition',
                        filterColumn === c.key ? 'bg-ink text-white' : 'hover:bg-surface-sunken text-ink',
                      )}
                    >
                      <span className="truncate">{c.label}</span>
                      {filters[c.key]?.size ? (
                        <span className={cn('ml-2 text-[10px]', filterColumn === c.key ? 'text-white' : 'text-accent')}>
                          {filters[c.key].size}
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>

            <div>
              {filterColumn ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      value={valueSearch}
                      onChange={e => setValueSearch(e.target.value)}
                      placeholder={`Find a value in ${labelFor(filterColumn)}…`}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-surface-border text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {filters[filterColumn]?.size ? (
                      <button
                        onClick={() => setFilters(prev => { const n = { ...prev }; delete n[filterColumn]; return n; })}
                        className="text-[11px] text-ink-muted hover:text-ink whitespace-nowrap"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                    {filterValues
                      .filter(v => !valueSearch || v.value.toLowerCase().includes(valueSearch.toLowerCase()))
                      .slice(0, 500)
                      .map(({ value, count }) => {
                        const on = filters[filterColumn]?.has(value) ?? false;
                        return (
                          <button
                            key={value || '(blank)'}
                            onClick={() => toggleFilterValue(filterColumn, value)}
                            className="flex items-center gap-2 text-left px-2 py-1 rounded-lg text-[11px] hover:bg-surface-sunken"
                          >
                            <span className={cn(
                              'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                              on ? 'bg-accent border-accent text-white' : 'border-surface-border bg-white',
                            )}>
                              {on && <Check size={9} />}
                            </span>
                            <span className={cn('truncate', !value && 'italic text-ink-faint')}>
                              {value || '(blank)'}
                            </span>
                            <span className="ml-auto text-[10px] text-ink-faint">{count}</span>
                          </button>
                        );
                      })}
                  </div>
                </>
              ) : (
                <p className="text-xs text-ink-muted p-2">
                  Pick a column on the left to filter its values.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!error && data && (
        <div className="border border-surface-border rounded-xl overflow-auto max-h-[65vh] bg-white">
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-20">
              <tr>
                {visible.map((c, pos) => {
                  const isPinned = pinned.includes(c.key);
                  return (
                    <th
                      key={`${c.key}-${c.i}`}
                      title={c.description || c.key}
                      style={isPinned
                        ? { left: pinned.indexOf(c.key) * PINNED_WIDTH, width: PINNED_WIDTH, minWidth: PINNED_WIDTH }
                        : undefined}
                      className={cn(
                        'text-left font-semibold text-ink-muted whitespace-nowrap px-3 py-2 bg-surface-sunken border-b border-surface-border',
                        isPinned && 'sticky z-30 border-r',
                        isPinned && pos === pinned.length - 1 && 'shadow-[2px_0_4px_rgba(0,0,0,0.04)]',
                      )}
                    >
                      {c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="hover:bg-surface-sunken/60 group">
                  {visible.map((c, pos) => {
                    const isPinned = pinned.includes(c.key);
                    return (
                      <td
                        key={`${c.key}-${c.i}`}
                        title={row[c.i]}
                        style={isPinned
                          ? { left: pinned.indexOf(c.key) * PINNED_WIDTH, width: PINNED_WIDTH, minWidth: PINNED_WIDTH }
                          : undefined}
                        className={cn(
                          'px-3 py-1.5 border-b border-surface-border truncate',
                          isPinned
                            ? 'sticky z-10 bg-white group-hover:bg-surface-sunken font-medium text-ink border-r'
                            : 'max-w-[280px] text-ink-muted',
                          isPinned && pos === pinned.length - 1 && 'shadow-[2px_0_4px_rgba(0,0,0,0.04)]',
                        )}
                      >
                        {row[c.i]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-6 text-center text-sm text-ink-muted">
              Nothing matches the current search and filters.
            </p>
          )}
        </div>
      )}

      {loading && !data && (
        <p className="p-6 text-center text-sm text-ink-muted">Loading…</p>
      )}

      {/* Tab bar on the viewport floor — switching datasets is navigation, and
          navigation belongs where the thumb and the eye already are, not above
          three rows of controls. */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-surface-border bg-white/95 backdrop-blur px-6 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setActive(t.key); setSearch(''); setPanel(null); }}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold border transition',
                active === t.key
                  ? 'bg-ink text-white border-ink'
                  : 'bg-surface border-surface-border text-ink-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
          {data && (
            <span className="ml-auto text-[11px] text-ink-faint">
              {data.mapped ? 'Labels from mapping sheet' : 'Raw column names'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelButton({
  icon, label, badge, open, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition',
        open
          ? 'bg-ink text-white border-ink'
          : 'bg-surface border-surface-border text-ink-muted hover:text-ink',
      )}
    >
      {icon}
      {label}
      {badge && (
        <span className={cn(
          'text-[10px] rounded-full px-1.5 py-0.5 leading-none',
          open ? 'bg-white/20' : 'bg-surface-sunken text-ink-muted',
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}
