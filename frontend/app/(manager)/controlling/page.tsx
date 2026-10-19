'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowDown, ArrowUp, Download, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { controlling as api, type ControllingSource, type ControllingTable } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * Controlling (Oct 2026) — tables sourced from outside CleanOps (BigQuery
 * today, APIs and other databases later), read-only, for the manager.
 *
 * The server hands over the whole table (cached 10 min); search, sort and
 * paging happen here. Columns come from the source's own schema, so a new
 * column in BigQuery appears without a deploy.
 */

const PAGE = 100;
const NUMERIC = new Set(['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC']);

export default function ControllingPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [sources, setSources] = useState<ControllingSource[]>([]);
  const [active, setActive] = useState('');
  const [table, setTable] = useState<ControllingTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);

  // Manager only — the API refuses everyone else; the page should not pretend otherwise.
  useEffect(() => { if (user && user.role !== 'MANAGER') router.replace('/'); }, [user, router]);

  useEffect(() => {
    api.sources()
      .then((s) => { setSources(s); if (s.length) setActive((a) => a || s[0].key); })
      .catch((e: any) => setError(e?.message ?? 'Could not load the sources'));
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (!active) return;
    setLoading(true); setError('');
    try {
      setTable(await api.read(active, refresh));
      setPage(0);
    } catch (e: any) {
      setError(e?.message ?? 'Could not read the source');
    } finally {
      setLoading(false);
    }
  }, [active]);
  useEffect(() => { void load(false); }, [load]);

  const rows = useMemo(() => {
    if (!table) return [];
    const needle = q.trim().toLowerCase();
    let out = needle
      ? table.rows.filter((r) => Object.values(r).some((v) => v !== null && String(v).toLowerCase().includes(needle)))
      : table.rows;
    if (sort) {
      const num = NUMERIC.has(table.columns.find((c) => c.key === sort.key)?.type ?? '');
      const dir = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (x === null || x === '') return 1;
        if (y === null || y === '') return -1;
        if (num) return (Number(x) - Number(y)) * dir;
        return String(x).localeCompare(String(y), 'cs', { numeric: true, sensitivity: 'base' }) * dir;
      });
    }
    return out;
  }, [table, q, sort]);

  useEffect(() => { setPage(0); }, [q, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  function cycleSort(key: string) {
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  }

  function exportCsv() {
    if (!table) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [table.columns.map((c) => esc(c.key)).join(','), ...rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(','))];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${table.source}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const fetched = table ? new Date(table.fetchedAt).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="p-6 max-w-full flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">Records</span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Controlling</h1>
          <p className="text-sm text-ink-muted">Data from outside CleanOps, read-only. {table && <span className="font-mono text-[12px]">{table.origin}</span>}</p>
        </div>
        {sources.length > 0 && (
          <div role="tablist" aria-label="Source" className="flex flex-wrap gap-1 bg-white border border-surface-border rounded-[10px] p-[3px]">
            {sources.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={active === s.key}
                onClick={() => { setActive(s.key); setTable(null); setQ(''); setSort(null); }}
                title={s.origin}
                className={cn('rounded-lg px-3 py-1.5 text-[13px] transition',
                  active === s.key ? 'bg-accent text-white font-semibold' : 'text-ink-soft hover:bg-surface-sunken')}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {table && (
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
          <Figure label="Rows" value={table.total.toLocaleString('cs-CZ')} unit={table.truncated ? 'first 20 000 only' : 'in the source'} />
          <Figure label="Shown" value={rows.length.toLocaleString('cs-CZ')} unit={q ? 'matching the search' : 'all of them'} />
          <Figure label="Columns" value={String(table.columns.length)} unit="from the source schema" />
          <Figure label="Read at" value={fetched} unit="cached 10 min" />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <section className="bg-white border border-surface-border rounded-2xl flex flex-col min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#EFEAE0]">
          <h2 className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted">
            {table ? `${table.label} · ${table.total.toLocaleString('cs-CZ')} rows` : 'Loading…'}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="h-8 w-[280px] flex items-center gap-2 px-2.5 rounded-lg border border-surface-border bg-white">
              <Search size={13} className="text-ink-muted flex-shrink-0" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all rows · any column"
                aria-label="Search all rows" className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-ink-muted" />
            </label>
            {sort && (
              <button onClick={() => setSort(null)} className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg bg-accent-soft text-accent text-[12px] font-semibold">
                {sort.key} {sort.dir === 'asc' ? '↑' : '↓'} <X size={11} />
              </button>
            )}
            <button onClick={exportCsv} disabled={!table || rows.length === 0}
              className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg border border-surface-border bg-white text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
              <Download size={13} /> CSV
            </button>
            <button onClick={() => void load(true)} disabled={loading || !active} aria-label="Read again from the source" title="Read again from the source"
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-surface-border bg-white text-ink-muted hover:text-ink disabled:opacity-50">
              <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="overflow-auto max-h-[68vh]">
          {loading && !table ? (
            <div className="py-16 text-center text-ink-muted"><Loader2 size={20} className="inline animate-spin" /></div>
          ) : table && (
            <table className="text-[12.5px] border-separate" style={{ borderSpacing: 0 }}>
              <thead>
                <tr>
                  {table.columns.map((c, i) => (
                    <th
                      key={c.key}
                      onClick={() => cycleSort(c.key)}
                      title={`${c.key} · ${c.type}`}
                      className={cn(
                        'sticky top-0 z-20 bg-[#FBFAF6] px-3 py-2 text-left whitespace-nowrap font-semibold border-b border-surface-border cursor-pointer select-none',
                        sort?.key === c.key ? 'text-ink' : 'text-ink-muted hover:text-ink',
                        i === 0 && 'left-0 z-30 border-r',
                        NUMERIC.has(c.type) && 'text-right',
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.key}
                        {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, ri) => (
                  <tr key={ri} className="group">
                    {table.columns.map((c, i) => {
                      const v = r[c.key];
                      return (
                        <td
                          key={c.key}
                          title={v === null ? '' : String(v)}
                          className={cn(
                            'px-3 py-2 border-b border-[#F3EFE7] whitespace-nowrap max-w-[320px] truncate group-hover:bg-[#FBFAF6]',
                            i === 0 ? 'sticky left-0 z-10 bg-white font-semibold text-ink border-r border-r-surface-border' : 'text-ink-soft',
                            NUMERIC.has(c.type) && 'text-right tabular-nums font-mono text-[12px]',
                          )}
                        >
                          {v === null || v === '' ? <span className="text-ink-faint">—</span>
                            : typeof v === 'boolean' ? <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', v ? 'bg-accent-soft text-accent' : 'bg-surface-sunken text-ink-muted')}>{v ? 'true' : 'false'}</span>
                            : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {table && rows.length === 0 && <p className="py-10 text-center text-sm text-ink-muted">Nothing matches the search.</p>}
        </div>

        {table && rows.length > PAGE && (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-[#EFEAE0] text-[11.5px] text-ink-muted">
            <span>{(page * PAGE + 1).toLocaleString('cs-CZ')}–{Math.min(rows.length, (page + 1) * PAGE).toLocaleString('cs-CZ')} of {rows.length.toLocaleString('cs-CZ')}</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page"
                className="w-7 h-7 rounded-lg border border-surface-border bg-white text-ink-soft disabled:opacity-40">‹</button>
              <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page"
                className="w-7 h-7 rounded-lg bg-accent text-white disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-white border border-surface-border rounded-2xl px-4 py-3 flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-muted truncate">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold tracking-tight text-ink leading-none">{value}</span>
        <span className="text-[13px] text-ink-muted truncate">{unit}</span>
      </span>
    </div>
  );
}
