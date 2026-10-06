'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, Lock, Save, X, RotateCcw } from 'lucide-react';
import {
  datasets as api,
  type DatasetColumn,
  type DatasetFieldChange,
  type DatasetPage,
} from '@/lib/api';
import { cn } from '@/lib/utils';

/** Unsaved edits of one row: column key → the value as typed (a string, like every cell). */
export type RowDraft = Record<string, string>;

/** Columns whose value names the record best, in order of preference. */
const TITLE_KEYS = ['titleAvantio', 'displayName', 'nickname', 'idAvantio', 'internalId', 'lastName'];

export function rowTitle(page: DatasetPage, rowIndex: number): string {
  const row = page.rows[rowIndex] ?? [];
  for (const k of TITLE_KEYS) {
    const i = page.columns.findIndex((c) => c.key === k);
    if (i >= 0 && row[i]) return row[i];
  }
  return row[0] || `#${rowIndex + 1}`;
}

export const isEditable = (page: DatasetPage | null, c: DatasetColumn) =>
  !!page?.canEdit && c.access === 'edit';

/**
 * The input for one editable value, chosen by the column: a pick list or a
 * TRUE/FALSE column is a select (nothing else can be entered), numbers and
 * dates get their own inputs, the rest is text. The value stays a string —
 * the server parses and validates it by the column's type.
 */
export function ValueInput({
  column, value, onChange, onCommit, onCancel, autoFocus, className,
}: {
  column: DatasetColumn;
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onCommit?.(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
  };
  const base = cn(
    'w-full h-full min-h-[26px] px-2 rounded-md border border-amber-400 bg-white text-xs text-ink',
    'focus:outline-none focus:ring-2 focus:ring-accent',
    className,
  );

  const choices = column.options
    ? column.options
    : column.type === 'bool'
      ? ['TRUE', 'FALSE']
      : null;

  if (choices) {
    // A value already in the row that is no longer allowed stays visible (so
    // nothing silently changes), but it cannot be picked again.
    const stale = value && !choices.includes(value) ? value : null;
    return (
      <select
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={keys}
        className={base}
        aria-label={column.label}
      >
        <option value="">—</option>
        {stale && <option value={stale} disabled>{stale} (not allowed)</option>}
        {choices.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  const numeric = column.type === 'int' || column.type === 'float' || column.type === 'decimal';
  return (
    <input
      ref={ref}
      type={column.type === 'date' ? 'date' : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={keys}
      className={base}
      aria-label={column.label}
    />
  );
}

/**
 * The per-row Save bar. One entry per row with unsaved edits; each saves or
 * discards that row alone, so a failed save never takes other rows with it.
 */
export function SaveBar({
  page, drafts, saving, errors, onSave, onDiscard, onOpen,
}: {
  page: DatasetPage;
  drafts: Record<number, RowDraft>;
  saving: Record<number, boolean>;
  errors: Record<number, string>;
  onSave: (row: number) => void;
  onDiscard: (row: number) => void;
  onOpen: (row: number) => void;
}) {
  const dirty = Object.keys(drafts).map(Number).filter((r) => Object.keys(drafts[r] ?? {}).length > 0);
  if (dirty.length === 0) return null;
  return (
    <div className="fixed bottom-0 left-56 right-0 z-50 pointer-events-none">
      <div className="max-w-5xl mx-auto px-6 pb-5 space-y-2">
        {dirty.map((r) => {
          const n = Object.keys(drafts[r]).length;
          return (
            <div
              key={r}
              className="pointer-events-auto flex items-center gap-3 bg-ink text-white rounded-2xl shadow-modal px-5 py-3 animate-scale-in"
            >
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="flex-1 min-w-0 text-left"
                title="Open the record"
              >
                <span className="block text-sm font-semibold truncate">{rowTitle(page, r)}</span>
                <span className={cn('block text-xs', errors[r] ? 'text-red-300' : 'text-white/60')}>
                  {errors[r] ?? `${n} unsaved change${n === 1 ? '' : 's'}`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDiscard(r)}
                disabled={saving[r]}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition disabled:opacity-50"
              >
                <RotateCcw size={13} />
                Discard
              </button>
              <button
                type="button"
                onClick={() => onSave(r)}
                disabled={saving[r]}
                className="flex items-center gap-2 px-4 py-2 bg-white text-ink rounded-xl text-sm font-semibold hover:bg-surface transition disabled:opacity-50"
              >
                {saving[r] ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Prague', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/**
 * The whole record as a form, with each field's change history.
 *
 * Shares the page's draft for this row, so an edit typed in the grid shows up
 * here and the other way round — one row, one Save.
 */
export function RecordDrawer({
  page, row, draft, saving, error, groupLabel, onChange, onSave, onDiscard, onClose, historyVersion,
}: {
  page: DatasetPage;
  row: number;
  draft: RowDraft;
  saving: boolean;
  error?: string;
  groupLabel: (g: string) => string;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** Bumped after a save, so the history re-reads. */
  historyVersion: number;
}) {
  const rowId = page.rowIds?.[row];
  const [history, setHistory] = useState<DatasetFieldChange[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rowId) return;
    let alive = true;
    setHistoryError('');
    api.history(page.key, rowId)
      .then((h) => { if (alive) setHistory(h); })
      .catch((e) => { if (alive) setHistoryError(e?.message ?? 'Could not load history'); });
    return () => { alive = false; };
  }, [page.key, rowId, historyVersion]);

  const byField = useMemo(() => {
    const m = new Map<string, DatasetFieldChange[]>();
    for (const h of history ?? []) m.set(h.field, [...(m.get(h.field) ?? []), h]);
    return m;
  }, [history]);

  // Grouped as the columns are, in column order.
  const sections = useMemo(() => {
    const out: { group: string; cols: { c: DatasetColumn; i: number }[] }[] = [];
    page.columns.forEach((c, i) => {
      const g = c.group ?? '';
      const last = out[out.length - 1];
      if (last && last.group === g) last.cols.push({ c, i });
      else out.push({ group: g, cols: [{ c, i }] });
    });
    return out;
  }, [page.columns]);

  const dirty = Object.keys(draft).length;
  const editableCount = page.columns.filter((c) => isEditable(page, c)).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={rowTitle(page, row)}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside className="relative w-full max-w-[560px] h-full bg-white shadow-modal flex flex-col animate-slide-up">
        <header className="px-5 pt-5 pb-4 border-b border-surface-border flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{page.label}</p>
            <h2 className="text-lg font-bold text-ink truncate">{rowTitle(page, row)}</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {editableCount > 0
                ? `You can edit ${editableCount} field${editableCount === 1 ? '' : 's'}; the rest are read-only for your role.`
                : 'Read-only for your role.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-surface-sunken text-ink-muted">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {historyError && <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{historyError}</p>}
          {sections.map(({ group, cols }, s) => (
            <section key={`${group}-${s}`} className="space-y-1.5">
              {group && (
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted pt-1">{groupLabel(group)}</h3>
              )}
              {cols.map(({ c, i }) => {
                const stored = page.rows[row]?.[i] ?? '';
                const value = draft[c.key] ?? stored;
                const editable = isEditable(page, c);
                const changes = byField.get(c.key) ?? [];
                const isOpen = open.has(c.key);
                return (
                  <div key={c.key} className="rounded-xl border border-transparent hover:border-surface-border">
                    <div className="grid grid-cols-[11rem_minmax(0,1fr)_2rem] items-center gap-2 px-2 py-1.5">
                      <label className="text-xs font-medium text-ink-muted truncate" title={c.description ?? c.key}>
                        {c.label}
                      </label>
                      {editable ? (
                        <ValueInput
                          column={c}
                          value={value}
                          onChange={(v) => onChange(c.key, v)}
                          className={draft[c.key] !== undefined ? 'bg-amber-50' : 'border-surface-border'}
                        />
                      ) : (
                        <span className="text-xs text-ink break-words flex items-center gap-1.5 min-h-[26px]">
                          {stored || <span className="text-ink-faint">—</span>}
                          <Lock size={10} className="text-ink-faint flex-shrink-0" aria-label="Read-only" />
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={changes.length === 0}
                        onClick={() => setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.key)) next.delete(c.key); else next.add(c.key);
                          return next;
                        })}
                        title={changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No changes recorded'}
                        className={cn(
                          'relative w-7 h-7 rounded-lg flex items-center justify-center transition',
                          changes.length ? 'text-ink-muted hover:text-ink hover:bg-surface-sunken' : 'text-stone-200',
                        )}
                      >
                        <History size={13} />
                        {changes.length > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-ink text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                            {changes.length}
                          </span>
                        )}
                      </button>
                    </div>
                    {isOpen && changes.length > 0 && (
                      <ol className="mx-2 mb-2 ml-[11.5rem] border-l-2 border-surface-border pl-3 space-y-1.5">
                        {changes.map((h) => (
                          <li key={h.id} className="text-[11.5px] text-ink-soft">
                            <span className="text-ink-muted">{when(h.createdAt)}</span>
                            {' · '}
                            <span className="font-medium">{h.actorEmail ?? 'unknown'}</span>
                            {h.actorRole && <span className="text-ink-muted"> ({h.actorRole})</span>}
                            <div>
                              {h.masked ? (
                                <span className="italic text-ink-muted">changed — values not recorded (sensitive)</span>
                              ) : (
                                <>
                                  <span className="line-through text-ink-muted">{h.oldValue ?? '—'}</span>
                                  {' → '}
                                  <span className="font-semibold text-ink">{h.newValue ?? '—'}</span>
                                </>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        {editableCount > 0 && (
          <footer className="px-5 py-3 border-t border-surface-border flex items-center gap-3">
            <span className={cn('flex-1 text-xs', error ? 'text-red-700' : 'text-ink-muted')}>
              {error ?? (dirty ? `${dirty} unsaved change${dirty === 1 ? '' : 's'}` : 'No changes')}
            </span>
            <button
              type="button"
              onClick={onDiscard}
              disabled={!dirty || saving}
              className="px-3 py-2 rounded-xl text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface-sunken transition disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}

