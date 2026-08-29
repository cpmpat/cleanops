'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Database, RefreshCw, Search, Columns3, X, AlertCircle } from 'lucide-react';
import { datasets as api, type DatasetSummary, type DatasetPage } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Read-only viewer over the tenant's CDM spreadsheet.
 *
 * The Accommodation tab is ~140 columns wide, which rules out a plain table:
 * everything after the tenth column would be off-screen and the unit name —
 * the only thing that identifies a row — would scroll away with it. So the
 * first column is frozen, the header sticks, and there is a column picker.
 */
export default function DatasetsPage() {
  const [tabs, setTabs] = useState<DatasetSummary[]>([]);
  const [active, setActive] = useState<string>('');
  const [data, setData] = useState<DatasetPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

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
      setHidden(new Set());
    } catch (e: any) {
      setData(null);
      setError(e?.message || 'Could not read this dataset.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(active); }, [active, load]);

  const visibleColumns = useMemo(
    () => (data ? data.columns.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c)) : []),
    [data, hidden],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(row => row.some(cell => cell?.toLowerCase().includes(q)));
  }, [data, search]);

  return (
    <div className="p-6 max-w-full">
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

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setActive(t.key); setSearch(''); }}
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
        <button
          onClick={() => setPickerOpen(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border bg-surface text-sm font-semibold text-ink-muted hover:text-ink transition"
        >
          <Columns3 size={14} />
          Columns {data && `(${visibleColumns.length}/${data.columns.length})`}
        </button>
        {data && (
          <p className="text-xs text-ink-faint ml-auto">
            {rows.length.toLocaleString()} of {data.rows.length.toLocaleString()} rows
            {data.cached && ' · cached'}
          </p>
        )}
      </div>

      {pickerOpen && data && (
        <div className="mb-3 p-3 rounded-xl border border-surface-border bg-surface max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Show columns</p>
            <button onClick={() => setHidden(new Set())} className="text-xs text-accent font-semibold">
              Show all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.columns.map((c, i) => (
              <button
                key={`${c}-${i}`}
                onClick={() => setHidden(prev => {
                  const next = new Set(prev);
                  next.has(c) ? next.delete(c) : next.add(c);
                  return next;
                })}
                className={cn(
                  'px-2 py-1 rounded-lg text-[11px] border transition',
                  hidden.has(c)
                    ? 'bg-surface border-surface-border text-ink-faint line-through'
                    : 'bg-white border-surface-border text-ink',
                )}
              >
                {c}
              </button>
            ))}
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
        <div className="border border-surface-border rounded-xl overflow-auto max-h-[70vh] bg-white">
          <table className="text-xs border-collapse">
            <thead className="sticky top-0 z-20">
              <tr>
                {visibleColumns.map(({ c, i }, pos) => (
                  <th
                    key={`${c}-${i}`}
                    className={cn(
                      'text-left font-semibold text-ink-muted whitespace-nowrap px-3 py-2 bg-surface-sunken border-b border-surface-border',
                      pos === 0 && 'sticky left-0 z-30 border-r',
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="hover:bg-surface-sunken/60">
                  {visibleColumns.map(({ c, i }, pos) => (
                    <td
                      key={`${c}-${i}`}
                      title={row[i]}
                      className={cn(
                        'px-3 py-1.5 border-b border-surface-border max-w-[280px] truncate',
                        pos === 0
                          ? 'sticky left-0 z-10 bg-white font-medium text-ink border-r'
                          : 'text-ink-muted',
                      )}
                    >
                      {row[i]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-6 text-center text-sm text-ink-muted">Nothing matches “{search}”.</p>
          )}
        </div>
      )}

      {loading && !data && (
        <p className="p-6 text-center text-sm text-ink-muted">Loading…</p>
      )}
    </div>
  );
}
