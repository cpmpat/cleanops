'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Building2, UserRound, MapPin, Users, Database, Search, X, Lock, Plus } from 'lucide-react';
import { tasks as tasksApi, type LinkPick } from '@/lib/api';
import type { TaskStrings } from '@/i18n/tasks';
import { cn } from '@/lib/utils';

/**
 * Linking a task to Data records (16 Oct 2026): pick the table, then the
 * record, then — optionally — one attribute. The server offers only lists,
 * rows and attributes the person may see, and checks again on save.
 */

export const LIST_ICON: Record<string, React.ElementType> = {
  accommodation: Building2,
  owner: UserRound,
  oxpoint: MapPin,
  user: Users,
};

export interface PendingLink {
  dataset: string;
  rowId: string;
  field: string | null;
  datasetLabel: string;
  title: string;
  fieldLabel: string | null;
}

export function RecordPicker({ s, onAdd, exclude = [] }: {
  s: TaskStrings;
  onAdd: (l: PendingLink) => void | Promise<unknown>;
  exclude?: { dataset: string; rowId: string; field: string | null }[];
}) {
  const [lists, setLists] = useState<{ key: string; label: string }[]>([]);
  const [dataset, setDataset] = useState('');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<LinkPick | null>(null);
  const [row, setRow] = useState<{ rowId: string; title: string } | null>(null);
  const [field, setField] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    tasksApi.linkTargets().then((l) => { setLists(l); if (l[0]) setDataset(l[0].key); }).catch(() => {});
  }, []);

  // Search as you type; the last answer wins.
  const seq = useRef(0);
  useEffect(() => {
    if (!dataset) return;
    const n = ++seq.current;
    const id = window.setTimeout(() => {
      tasksApi.pick(dataset, q).then((p) => { if (n === seq.current) { setPick(p); setError(''); } })
        .catch((e) => { if (n === seq.current) setError(e?.message ?? 'Could not load'); });
    }, 200);
    return () => window.clearTimeout(id);
  }, [dataset, q]);

  function reset() { setRow(null); setField(''); setQ(''); }

  async function add() {
    if (!row || !pick) return;
    const f = pick.fields.find((x) => x.key === field);
    await onAdd({
      dataset, rowId: row.rowId, field: f ? f.key : null,
      datasetLabel: pick.label, title: row.title, fieldLabel: f ? f.label : null,
    });
    reset();
  }

  const taken = (rowId: string) => exclude.some((e) => e.dataset === dataset && e.rowId === rowId && e.field === (field || null));
  if (!lists.length) return null;

  return (
    <div className="rounded-xl ring-1 ring-black/[0.08] bg-[#FBFAF6] p-2.5 space-y-2">
      <div className="flex gap-2">
        <select value={dataset} onChange={(e) => { setDataset(e.target.value); reset(); }} title={s.pickTable}
          className="h-8 px-2 rounded-lg ring-1 ring-black/[0.08] bg-white text-[12.5px] outline-none">
          {lists.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        {row ? (
          <span className="flex-1 min-w-0 h-8 flex items-center gap-1.5 px-2 rounded-lg bg-white ring-1 ring-black/[0.12] text-[12.5px] text-[#1B2420]">
            <span className="truncate">{row.title}</span>
            <button type="button" onClick={reset} className="ml-auto text-[#6A6F69] hover:text-[#1B2420]"><X size={12} /></button>
          </span>
        ) : (
          <span className="flex-1 min-w-0 h-8 flex items-center gap-1.5 px-2 rounded-lg bg-white ring-1 ring-black/[0.08]">
            <Search size={12} className="text-[#6A6F69]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.pickRecord}
              className="flex-1 min-w-0 outline-none text-[12.5px] bg-transparent placeholder:text-[#6A6F69]" />
          </span>
        )}
      </div>

      {!row && pick && (
        <div className="max-h-40 overflow-y-auto rounded-lg bg-white ring-1 ring-black/[0.06] py-1">
          {pick.rows.length === 0 && <p className="px-3 py-2 text-[12px] text-[#6A6F69]">{s.noRecords}</p>}
          {pick.rows.map((r) => (
            <button key={r.rowId} type="button" onClick={() => setRow(r)}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-[#1B2420] hover:bg-[#F6F4EF] truncate">{r.title}</button>
          ))}
        </div>
      )}

      {row && pick && (
        <div className="flex gap-2">
          <select value={field} onChange={(e) => setField(e.target.value)} title={s.pickField}
            className="flex-1 min-w-0 h-8 px-2 rounded-lg ring-1 ring-black/[0.08] bg-white text-[12.5px] outline-none">
            <option value="">{s.wholeRecord}</option>
            {pick.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <button type="button" onClick={() => void add()} disabled={taken(row.rowId)}
            className="h-8 flex items-center gap-1 px-3 rounded-lg bg-[#1B2420] text-white text-[12.5px] font-semibold disabled:opacity-40">
            <Plus size={13} /> {s.addLink}
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  );
}

/** One linked record. Opens it on Data when the viewer may see it; otherwise says only that it is restricted. */
export function LinkChip({ link, s, onRemove, compact }: {
  link: { dataset: string; rowId: string; visible?: boolean; datasetLabel: string; title: string | null; fieldLabel: string | null };
  s: TaskStrings;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const Icon = LIST_ICON[link.dataset] ?? Database;
  const visible = link.visible !== false;
  const body = (
    <>
      {visible ? <Icon size={compact ? 11 : 13} className="flex-shrink-0 text-[#6A6F69]" /> : <Lock size={compact ? 11 : 13} className="flex-shrink-0 text-[#6A6F69]" />}
      <span className="truncate">
        {visible ? (
          <>
            {!compact && <span className="text-[#6A6F69]">{link.datasetLabel} · </span>}
            <span className="text-[#1B2420]">{link.title}</span>
            {link.fieldLabel && <span className="text-[#6A6F69]"> · {link.fieldLabel}</span>}
          </>
        ) : <span className="text-[#6A6F69]">{s.restricted}</span>}
      </span>
    </>
  );
  const cls = cn('inline-flex items-center gap-1.5 max-w-full rounded-lg bg-[#F6F4EF]', compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-[12.5px]');
  return (
    <span className={cn(cls, 'group')}>
      {visible ? (
        <Link href={`/datasets?d=${encodeURIComponent(link.dataset)}&row=${encodeURIComponent(link.rowId)}&t=${Date.now()}`}
          onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 min-w-0 hover:underline">{body}</Link>
      ) : <span className="inline-flex items-center gap-1.5 min-w-0">{body}</span>}
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-[#6A6F69] hover:text-[#1B2420] flex-shrink-0"><X size={12} /></button>
      )}
    </span>
  );
}
