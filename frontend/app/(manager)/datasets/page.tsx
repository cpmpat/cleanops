'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Database, RefreshCw, Search, Columns3, Filter, Snowflake, Plus, Loader2,
  X, AlertCircle, Check, ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react';
import { datasets as api, type DatasetSummary, type DatasetPage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Column width is fixed, so horizontal offsets are pure arithmetic.
 *
 * Vertical offsets are not: a row's real height is padding + border + whatever
 * the font metrics produce, and guessing it puts the frozen band a pixel or two
 * off the header. The gap is small but it is a hole, and the rows scrolling
 * underneath show through it. So the frozen rows are measured, once per layout,
 * and these two numbers are only the first-paint estimate.
 */
const COL_W = 190;
const HEAD_H = 36;
const ROW_H = 30;

type SortDir = 'asc' | 'desc';

/**
 * Read-only viewer over the tenant's CDM spreadsheet.
 *
 * ~140 columns and hundreds of rows, so it borrows the three things a
 * spreadsheet gives you for that shape: frozen panes, sortable headers, and
 * per-column value filters. Column labels and hover descriptions come from the
 * sheet's own mapping tab, so the table speaks the operator's vocabulary.
 */
export default function DatasetsPage() {
  const [tabs, setTabs] = useState<DatasetSummary[]>([]);
  const [active, setActive] = useState<string>('');
  const [data, setData] = useState<DatasetPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);

  // Frozen panes, counted from the top-left exactly like Sheets.
  const [frozenCols, setFrozenCols] = useState(1);
  const [frozenRows, setFrozenRows] = useState(0);

  // Measured sticky offsets: rowTops[r] is where frozen row r must park so the
  // band is flush with the header and with the row above it.
  const tableRef = useRef<HTMLTableElement>(null);
  const [rowTops, setRowTops] = useState<number[]>([]);

  const [adding, setAdding] = useState(false);

  const [panel, setPanel] = useState<'columns' | 'rows' | 'freeze' | null>(null);
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
      const raw = await api.read(key, refresh);

      // Tolerate the pre-mapping API shape, where `columns` was a plain string
      // array. During a rollout the frontend can land before the backend, and
      // spreading a string into an object turns it into {0:'i',1:'d',…} — every
      // key undefined, one column surviving the filters, a table of blanks.
      const page: DatasetPage = {
        ...raw,
        columns: (raw.columns as unknown[]).map((c) =>
          typeof c === 'string'
            ? { key: c, label: c, hiddenByDefault: false, type: 'text', required: false }
            : (c as DatasetPage['columns'][number]),
        ),
      };
      setData(page);
      setHidden(new Set(page.columns.filter(c => c.hiddenByDefault).map(c => c.key)));
      setFilters({});
      setSort(null);
      setFilterColumn('');
    } catch (e: any) {
      setData(null);
      setError(e?.message || 'Could not read this dataset.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(active); }, [active, load]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.columns
      .map((c, i) => ({ ...c, i }))
      .filter(c => !hidden.has(c.key));
  }, [data, hidden]);

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
    const activeFilters = Object.entries(filters).filter(([, set]) => set.size > 0);

    let out = data.rows.filter(row => {
      for (const [key, allowed] of activeFilters) {
        const idx = data.columns.findIndex(c => c.key === key);
        if (idx >= 0 && !allowed.has(row[idx] ?? '')) return false;
      }
      if (!q) return true;
      return row.some(cell => cell?.toLowerCase().includes(q));
    });

    if (sort) {
      const idx = data.columns.findIndex(c => c.key === sort.key);
      if (idx >= 0) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        // Numeric where both sides are numbers, text otherwise. Blanks sort
        // last in both directions: an empty cell is absence, not a low value.
        out = [...out].sort((a, b) => {
          const x = a[idx] ?? '', y = b[idx] ?? '';
          if (!x && !y) return 0;
          if (!x) return 1;
          if (!y) return -1;
          const nx = Number(x.replace(',', '.')), ny = Number(y.replace(',', '.'));
          if (!Number.isNaN(nx) && !Number.isNaN(ny)) return (nx - ny) * dir;
          return x.localeCompare(y, undefined, { numeric: true }) * dir;
        });
      }
    }
    return out;
  }, [data, search, filters, sort]);

  /**
   * The frozen band has to sit exactly under the header, and each frozen row
   * exactly under the one above it. Those distances are whatever the browser
   * actually laid out, not what the constants above predict, so read them back.
   *
   * A ResizeObserver on the table catches the cases a render-time measurement
   * would miss: a web font landing, the window narrowing, a long value forcing
   * a taller row.
   */
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || frozenRows === 0) {
      setRowTops(prev => (prev.length === 0 ? prev : []));
      return;
    }

    const measure = () => {
      const head = table.tHead;
      const body = table.tBodies[0];
      if (!head || !body) return;
      const tops: number[] = [];
      let offset = head.getBoundingClientRect().height;
      for (let r = 0; r < frozenRows && r < body.rows.length; r++) {
        tops.push(Math.round(offset));
        offset += body.rows[r].getBoundingClientRect().height;
      }
      setRowTops(prev =>
        prev.length === tops.length && prev.every((v, i) => v === tops[i]) ? prev : tops,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return () => observer.disconnect();
  }, [frozenRows, rows, visible.length, data]);

  const activeFilterCount = Object.values(filters).filter(s => s.size > 0).length;
  const labelFor = (key: string) => data?.columns.find(c => c.key === key)?.label ?? key;

  function cycleSort(key: string) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

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

  return (
    <div className="p-6 max-w-full">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Database size={22} className="text-ink-muted" />
            Datasets
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {data?.canCreate
              ? 'Stored in the database. Rows added here are saved immediately.'
              : 'Read-only view of the CDM spreadsheet. Changes made in the sheet appear here.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(active, true)}
            disabled={loading || !active}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border bg-surface text-sm font-semibold text-ink-muted hover:text-ink transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {/* Only for lists that live in Postgres. A sheet-backed list cannot
              be written to at all, so the button is absent rather than present
              and failing on submit. */}
          {data?.canCreate && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ink text-white text-sm font-semibold hover:bg-ink-soft transition"
            >
              <Plus size={15} />
              Add new
            </button>
          )}
        </div>
      </div>

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
          icon={<Columns3 size={14} />} label="Columns"
          badge={data ? `${visible.length}/${data.columns.length}` : undefined}
          open={panel === 'columns'}
          onClick={() => setPanel(p => (p === 'columns' ? null : 'columns'))}
        />
        <PanelButton
          icon={<Filter size={14} />} label="Rows"
          badge={activeFilterCount ? String(activeFilterCount) : undefined}
          open={panel === 'rows'}
          onClick={() => setPanel(p => (p === 'rows' ? null : 'rows'))}
        />
        <PanelButton
          icon={<Snowflake size={14} />} label="Freeze"
          badge={frozenCols || frozenRows ? `${frozenCols}×${frozenRows}` : undefined}
          open={panel === 'freeze'}
          onClick={() => setPanel(p => (p === 'freeze' ? null : 'freeze'))}
        />

        {data && (
          <p className="text-xs text-ink-faint ml-auto">
            {rows.length.toLocaleString()} of {data.rows.length.toLocaleString()} rows
            {data.cached && ' · cached'}
          </p>
        )}
      </div>

      {(activeFilterCount > 0 || sort) && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {sort && (
            <button
              onClick={() => setSort(null)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-sunken border border-surface-border text-[11px] font-medium text-ink"
            >
              Sorted by {labelFor(sort.key)} {sort.dir === 'asc' ? '↑' : '↓'}
              <X size={11} />
            </button>
          )}
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
          {activeFilterCount > 0 && (
            <button onClick={() => setFilters({})} className="text-[11px] text-ink-muted hover:text-ink px-1.5">
              Clear all
            </button>
          )}
        </div>
      )}

      {panel === 'freeze' && (
        <div className="mb-3 p-3 rounded-xl border border-surface-border bg-surface">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">Freeze panes</p>
          <p className="text-[11px] text-ink-faint mb-3">
            Counted from the top-left corner, like a spreadsheet. Frozen columns stay
            put while you scroll sideways; frozen rows stay under the header.
          </p>
          <div className="flex flex-wrap gap-6">
            <Stepper label="Columns" value={frozenCols} max={Math.min(6, visible.length)} onChange={setFrozenCols} />
            <Stepper label="Rows" value={frozenRows} max={5} onChange={setFrozenRows} />
          </div>
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
          <p className="text-[11px] text-ink-faint mb-2">Hover a column for its description.</p>
          <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
            {data.columns
              .filter(c => !columnSearch ||
                c.label.toLowerCase().includes(columnSearch.toLowerCase()) ||
                c.key.toLowerCase().includes(columnSearch.toLowerCase()))
              .map(c => (
                <button
                  key={c.key}
                  title={c.description ? `${c.description}\n\n(${c.key})` : c.key}
                  onClick={() => setHidden(prev => {
                    const next = new Set(prev);
                    next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                    return next;
                  })}
                  className={cn(
                    'px-2 py-1 rounded-lg text-[11px] border transition',
                    hidden.has(c.key)
                      ? 'bg-surface border-surface-border text-ink-faint line-through'
                      : 'bg-white border-surface-border text-ink',
                  )}
                >
                  {c.label}
                </button>
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
                <p className="text-xs text-ink-muted p-2">Pick a column on the left to filter its values.</p>
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

      {/* min-height matches max-height so the block occupies its final space
          from the first paint. Without it the footer renders directly under the
          controls and then jumps down the moment rows arrive. */}
      {!error && data && (
        <div className="border border-surface-border rounded-xl overflow-auto h-[65vh] bg-white">
          {/* border-separate, not border-collapse: with collapsed borders the
              table paints the cell borders itself, so a sticky cell scrolls
              away from its own border and leaves a hairline the rows below
              show through. Separate borders belong to the cell and travel with
              it. borderSpacing 0 keeps the grid looking collapsed. */}
          <table
            ref={tableRef}
            className="text-xs border-separate"
            style={{ tableLayout: 'fixed', borderSpacing: 0 }}
          >
            <thead>
              <tr>
                {visible.map((c, pos) => {
                  const frozen = pos < frozenCols;
                  const sorted = sort?.key === c.key;
                  return (
                    <th
                      key={`${c.key}-${c.i}`}
                      title={c.description ? `${c.description}\n\n(${c.key})` : c.key}
                      onClick={() => cycleSort(c.key)}
                      style={{
                        width: COL_W, minWidth: COL_W, height: HEAD_H,
                        ...(frozen ? { left: pos * COL_W } : {}),
                      }}
                      className={cn(
                        'sticky top-0 z-40 text-left font-semibold whitespace-nowrap px-3 bg-surface-sunken',
                        'border-b border-surface-border cursor-pointer select-none hover:text-ink',
                        sorted ? 'text-ink' : 'text-ink-muted',
                        frozen && 'z-50 border-r',
                        frozen && pos === frozenCols - 1 && 'shadow-[2px_0_4px_rgba(0,0,0,0.05)]',
                      )}
                    >
                      <span className="flex items-center gap-1">
                        <span className="truncate">{c.label}</span>
                        {sorted
                          ? (sort!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                          : <ChevronsUpDown size={10} className="opacity-0 group-hover:opacity-40" />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => {
                const rowFrozen = r < frozenRows;
                return (
                  <tr key={r} className={cn('group', !rowFrozen && 'hover:bg-surface-sunken/60')}>
                    {visible.map((c, pos) => {
                      const colFrozen = pos < frozenCols;
                      const stick = rowFrozen || colFrozen;
                      return (
                        <td
                          key={`${c.key}-${c.i}`}
                          title={row[c.i]}
                          style={{
                            width: COL_W, minWidth: COL_W, height: ROW_H,
                            ...(colFrozen ? { left: pos * COL_W } : {}),
                            ...(rowFrozen ? { top: rowTops[r] ?? HEAD_H + r * ROW_H } : {}),
                          }}
                          className={cn(
                            'px-3 border-b border-surface-border truncate',
                            stick && 'sticky bg-white',
                            rowFrozen && colFrozen ? 'z-30' : rowFrozen ? 'z-20' : colFrozen ? 'z-10' : '',
                            colFrozen ? 'font-medium text-ink border-r' : 'text-ink-muted',
                            rowFrozen && 'border-b-ink/10',
                            !stick && 'group-hover:bg-surface-sunken/0',
                            colFrozen && !rowFrozen && 'group-hover:bg-surface-sunken',
                            colFrozen && pos === frozenCols - 1 && 'shadow-[2px_0_4px_rgba(0,0,0,0.05)]',
                          )}
                        >
                          {row[c.i]}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-6 text-center text-sm text-ink-muted">
              Nothing matches the current search and filters.
            </p>
          )}
        </div>
      )}

      {adding && data && (
        <AddRowDialog
          dataset={data}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(active, true); }}
        />
      )}

      {!error && !data && (
        <div className="border border-surface-border rounded-xl h-[65vh] bg-white flex items-center justify-center">
          <p className="text-sm text-ink-muted">{loading ? 'Loading…' : ''}</p>
        </div>
      )}

      {/* Below the table rather than above the controls: switching dataset is
          navigation and reads better as a footer. Deliberately NOT fixed to the
          viewport — a fixed bar spans the whole window and slides under the
          sidebar, which is its own kind of wrong. */}
      <div className="mt-4 pt-3 border-t border-surface-border">
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
              {data.mapped
                ? `Labels from ${data.mappingTab ?? 'mapping sheet'}`
                : 'Raw column names — no mapping tab matched'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label, value, max, onChange,
}: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-ink-muted mb-1.5">{label}</p>
      <div className="flex items-center gap-1">
        {Array.from({ length: max + 1 }, (_, n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              'w-8 h-8 rounded-lg text-xs font-semibold border transition',
              value === n
                ? 'bg-ink text-white border-ink'
                : 'bg-white border-surface-border text-ink-muted hover:text-ink',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function PanelButton({
  icon, label, badge, open, onClick,
}: {
  icon: React.ReactNode; label: string; badge?: string; open: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition',
        open ? 'bg-ink text-white border-ink'
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

/**
 * Add a row to a database-backed list.
 *
 * The form is generated from the dataset's own column metadata rather than
 * written per list, so the next migrated list gets this screen for free — the
 * backend describes its columns and the inputs follow. `type` picks the input,
 * `required` decides what blocks the save, and `description` is the same hover
 * text the column picker shows.
 *
 * Blank fields are omitted from the request rather than sent as empty strings.
 * A column left alone should end up NULL, not "".
 */
function AddRowDialog({
  dataset, onClose, onSaved,
}: {
  dataset: DatasetPage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cols = dataset.columns;
  const missing = cols.filter((c) => c.required && !(values[c.key] ?? '').trim());

  async function save() {
    if (missing.length > 0) {
      setError(`Fill in: ${missing.map((c) => c.label).join(', ')}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim()) payload[k] = v.trim();
      }
      await api.create(dataset.key, payload);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Could not save the row.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-surface-border">
          <div>
            <h2 className="text-lg font-bold text-ink">New {dataset.label} record</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {cols.length} field{cols.length === 1 ? '' : 's'}. Anything left blank stays empty.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center">
            <X size={17} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {cols.map((c) => (
            <label key={c.key} className="flex flex-col gap-1" title={c.description ?? c.key}>
              <span className="text-[11px] font-semibold text-ink-muted">
                {c.label}
                {c.required && <span className="text-red-500 ml-0.5">*</span>}
              </span>

              {c.type === 'bool' ? (
                <select
                  value={values[c.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white"
                >
                  <option value="">—</option>
                  <option value="true">TRUE</option>
                  <option value="false">FALSE</option>
                </select>
              ) : (
                <input
                  type={c.type === 'int' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                  value={values[c.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
                  className="px-3 py-2 rounded-xl border border-surface-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              )}

              {c.description && (
                <span className="text-[10px] text-ink-faint leading-tight">{c.description}</span>
              )}
            </label>
          ))}
        </div>

        {error && (
          <p className="px-5 pb-2 text-xs text-red-600">{error}</p>
        )}

        <div className="flex justify-end gap-2 p-5 border-t border-surface-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-semibold text-ink-muted hover:text-ink transition"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-ink text-white text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
