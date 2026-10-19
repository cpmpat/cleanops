'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Building2, UserRound, MapPin, Loader2 } from 'lucide-react';
import { datasets as datasetsApi, type DatasetSearchHit } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The top-bar search (15 Oct 2026). Looks in one column per list —
 * Accommodation by titleAvantio, Owner by displayName, OX Point by street —
 * and the server answers only from lists and columns the role may view,
 * within its rows. Picking a hit opens that record's drawer on Data.
 *
 * Shift+S opens it from anywhere except while typing in a field.
 */

export const SEARCH_STRINGS: Record<string, {
  placeholder: string; hint: string; empty: string; tooShort: string; open: string; close: string;
}> = {
  en: { placeholder: 'Search accommodations, owners, OX points…', hint: 'Search', empty: 'Nothing found', tooShort: 'Type at least 2 characters', open: 'open', close: 'close' },
  cs: { placeholder: 'Hledat ubytování, majitele, OX pointy…', hint: 'Hledat', empty: 'Nic nenalezeno', tooShort: 'Napište alespoň 2 znaky', open: 'otevřít', close: 'zavřít' },
  ru: { placeholder: 'Поиск объектов, владельцев, OX points…', hint: 'Поиск', empty: 'Ничего не найдено', tooShort: 'Введите минимум 2 символа', open: 'открыть', close: 'закрыть' },
  uk: { placeholder: 'Пошук об’єктів, власників, OX points…', hint: 'Пошук', empty: 'Нічого не знайдено', tooShort: 'Введіть щонайменше 2 символи', open: 'відкрити', close: 'закрити' },
};

const ICONS: Record<string, React.ElementType> = {
  accommodation: Building2,
  owner: UserRound,
  oxpoint: MapPin,
};

/** Is the key press happening inside something the person is typing in? */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** The ⇧ S cue, drawn as two key caps. */
export function ShortcutCue({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-0.5', className)} aria-hidden>
      <kbd className="min-w-[20px] h-5 px-1 rounded-[5px] border border-black/10 bg-[#F6F4EF] text-[11px] font-medium text-[#6A6F69] flex items-center justify-center font-sans">⇧</kbd>
      <kbd className="min-w-[20px] h-5 px-1 rounded-[5px] border border-black/10 bg-[#F6F4EF] text-[11px] font-medium text-[#6A6F69] flex items-center justify-center font-sans">S</kbd>
    </span>
  );
}

export function CommandSearch({ open, onClose, locale }: { open: boolean; onClose: () => void; locale: string }) {
  const s = SEARCH_STRINGS[locale] ?? SEARCH_STRINGS.en;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DatasetSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSel(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  // Debounced; the last answer wins even if an older one arrives late.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBusy(false); return; }
    let alive = true;
    setBusy(true);
    const id = window.setTimeout(() => {
      datasetsApi.search(term)
        .then((r) => { if (alive) { setHits(r.results); setSel(0); } })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 180);
    return () => { alive = false; window.clearTimeout(id); };
  }, [q, open]);

  const groups = useMemo(() => {
    const out: { label: string; dataset: string; items: { hit: DatasetSearchHit; index: number }[] }[] = [];
    hits.forEach((hit, index) => {
      let g = out.find((x) => x.dataset === hit.dataset);
      if (!g) { g = { label: hit.label, dataset: hit.dataset, items: [] }; out.push(g); }
      g.items.push({ hit, index });
    });
    return out;
  }, [hits]);

  function go(hit: DatasetSearchHit) {
    onClose();
    setQ('');
    router.push(`/datasets?d=${encodeURIComponent(hit.dataset)}&row=${encodeURIComponent(hit.rowId)}&t=${Date.now()}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[sel]; if (h) go(h); }
  }

  if (!open) return null;
  const term = q.trim();

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true">
      <button aria-label={s.close} className="absolute inset-0 bg-[#1B2420]/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-[0_24px_64px_-12px_rgba(16,24,40,0.28)] ring-1 ring-black/[0.06] overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-black/[0.06]">
          {busy ? <Loader2 size={18} className="text-[#6A6F69] animate-spin" /> : <Search size={18} className="text-[#6A6F69]" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={s.placeholder}
            className="flex-1 bg-transparent outline-none text-[15px] text-[#1B2420] placeholder:text-[#6A6F69]"
          />
          <kbd className="h-5 px-1.5 rounded-[5px] border border-black/10 bg-[#F6F4EF] text-[11px] text-[#6A6F69] font-sans">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {term.length < 2 ? (
            <p className="px-4 py-6 text-center text-sm text-[#6A6F69]">{s.tooShort}</p>
          ) : !busy && hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[#6A6F69]">{s.empty}</p>
          ) : (
            groups.map((g) => {
              const Icon = ICONS[g.dataset] ?? Search;
              return (
                <div key={g.dataset} className="px-2 pb-1">
                  <p className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6A6F69]">{g.label}</p>
                  {g.items.map(({ hit, index }) => (
                    <button
                      key={`${hit.dataset}:${hit.rowId}`}
                      onMouseEnter={() => setSel(index)}
                      onClick={() => go(hit)}
                      className={cn(
                        'w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors',
                        sel === index ? 'bg-[#F6F4EF]' : 'hover:bg-[#FBFAF6]',
                      )}
                    >
                      <span className="w-7 h-7 rounded-lg bg-[#F6F4EF] ring-1 ring-black/[0.04] flex items-center justify-center flex-shrink-0">
                        <Icon size={14} className="text-[#3D433E]" />
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[13.5px] text-[#1B2420]">{hit.title}</span>
                      {sel === index && <CornerDownLeft size={14} className="text-[#6A6F69] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 h-10 border-t border-black/[0.06] text-[11px] text-[#6A6F69]">
          <span className="flex items-center gap-1"><kbd className="px-1 rounded border border-black/10 bg-[#F6F4EF] font-sans">↑</kbd><kbd className="px-1 rounded border border-black/10 bg-[#F6F4EF] font-sans">↓</kbd></span>
          <span className="flex items-center gap-1"><kbd className="px-1 rounded border border-black/10 bg-[#F6F4EF] font-sans">↵</kbd> {s.open}</span>
          <span className="flex items-center gap-1"><kbd className="px-1 rounded border border-black/10 bg-[#F6F4EF] font-sans">Esc</kbd> {s.close}</span>
        </div>
      </div>
    </div>
  );
}
