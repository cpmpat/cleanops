'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, RefreshCw, Activity, ArrowUpDown, X, ExternalLink,
  BedDouble, Sparkles, MessageSquare, AlertTriangle, Wrench, ClipboardCheck, PenLine,
} from 'lucide-react';
import { streams, ApiError } from '@/lib/api';
import type { StreamItem, StreamItemType } from '@/lib/api';
import { ManualEventComposer } from '@/components/ManualEventComposer';
import { useSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

/**
 * Stream — every record the tenant produces, on one timeline.
 *
 * Bookings run down the right, everything the team does runs down the left, and
 * the line between them is time. That split is the point: at a glance you see
 * what the guests did and what we did about it, and the gaps show up as gaps.
 */

const TYPES: {
  key: StreamItemType;
  label: string;
  side: 'left' | 'right';
  icon: React.ReactNode;
  dot: string;
  chip: string;
}[] = [
  { key: 'RESERVATION',   label: 'Rezervace',  side: 'right', icon: <BedDouble size={12} />,      dot: 'bg-sky-500',     chip: 'text-sky-700 bg-sky-50 border-sky-200' },
  { key: 'TURNOVER',      label: 'Úklidy',     side: 'left',  icon: <Sparkles size={12} />,       dot: 'bg-amber-400',   chip: 'text-amber-800 bg-amber-50 border-amber-300' },
  { key: 'DIRECT_CHAT',   label: 'Přímé chaty', side: 'left', icon: <MessageSquare size={12} />,  dot: 'bg-[#243b6b]',   chip: 'text-[#243b6b] bg-[#eef2fa] border-[#c8d4ea]' },
  { key: 'INCIDENT',      label: 'Incidenty',  side: 'left',  icon: <AlertTriangle size={12} />,  dot: 'bg-red-500',     chip: 'text-red-700 bg-red-50 border-red-200' },
  { key: 'REPAIR',        label: 'Opravy',     side: 'left',  icon: <Wrench size={12} />,         dot: 'bg-violet-500',  chip: 'text-violet-700 bg-violet-50 border-violet-200' },
  { key: 'INSPECTION',    label: 'Kontroly',   side: 'left',  icon: <ClipboardCheck size={12} />, dot: 'bg-teal-500',    chip: 'text-teal-700 bg-teal-50 border-teal-200' },
  { key: 'MANUAL',        label: 'Ručně',      side: 'left',  icon: <PenLine size={12} />,        dot: 'bg-stone-400',   chip: 'text-stone-700 bg-stone-100 border-stone-300' },
  { key: 'CLEANING',      label: 'Úklidy (staré)', side: 'left', icon: <Sparkles size={12} />,    dot: 'bg-stone-300',   chip: 'text-stone-600 bg-stone-50 border-stone-200' },
];

const META = Object.fromEntries(TYPES.map((t) => [t.key, t])) as Record<
  StreamItemType, (typeof TYPES)[number]
>;

export default function StreamsPage() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<StreamItemType[]>([]);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detail, setDetail] = useState<StreamItem | null>(null);

  const load = useCallback(
    async (reset = true, cursorOverride?: string | null) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError('');
      try {
        const res = await streams.feed({
          cursor: reset ? undefined : (cursorOverride ?? undefined),
          limit: 30,
          types: selectedTypes.length > 0 ? selectedTypes : undefined,
        });
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Načtení se nepovedlo');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [selectedTypes],
  );

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [selectedTypes]);
  useSocket({
    'stream:created': () => load(true),
    'stream:updated': () => load(true),
    'conversation:changed': () => load(true),
  });

  /**
   * The server always hands back newest-first (that is how the cursor works).
   * Flipping the order is a view decision over what is loaded, and "load more"
   * keeps reaching further back either way.
   */
  const ordered = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) =>
      oldestFirst
        ? a.occurredAt.localeCompare(b.occurredAt)
        : b.occurredAt.localeCompare(a.occurredAt),
    );
    return copy;
  }, [items, oldestFirst]);

  function toggleType(t: StreamItemType) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Stream</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            Rezervace vpravo, co jsme s nimi udělali vlevo
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setOldestFirst((v) => !v)}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-surface-border rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
          >
            <ArrowUpDown size={14} />
            {oldestFirst ? 'Od nejstarších' : 'Od nejnovějších'}
          </button>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-surface-border rounded-xl text-sm font-semibold hover:bg-surface-sunken transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setComposerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition"
          >
            <Plus size={15} />
            Nová událost
          </button>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-1.5 flex-wrap mb-6">
        {TYPES.map((t) => {
          const on = selectedTypes.includes(t.key);
          return (
            <button
              key={t.key}
              onClick={() => toggleType(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition',
                on ? 'bg-ink text-white border-ink' : 'bg-white text-ink-muted border-surface-border hover:text-ink',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', t.dot)} />
              {t.label}
            </button>
          );
        })}
        {selectedTypes.length > 0 && (
          <button
            onClick={() => setSelectedTypes([])}
            className="text-xs font-semibold text-accent px-2 underline"
          >
            Zrušit filtr
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-white rounded-2xl border border-surface-border animate-pulse" />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-surface-border">
          <Activity size={30} className="mx-auto text-ink-faint mb-3" />
          <p className="text-sm font-semibold text-ink">Zatím tu nic není.</p>
        </div>
      ) : (
        <div className="relative">
          {/* the line itself */}
          <div className="absolute top-0 bottom-0 left-[19px] md:left-1/2 w-px bg-[#c8d4ea] md:-translate-x-px" />

          {ordered.map((item, i) => {
            const meta = META[item.type] ?? META.MANUAL;
            const prev = ordered[i - 1];
            const showDay =
              !prev || dayKey(prev.occurredAt) !== dayKey(item.occurredAt);

            return (
              <div key={item.id}>
                {showDay && <DayMarker iso={item.occurredAt} />}
                <TimelineRow item={item} meta={meta} onOpen={() => setDetail(item)} />
              </div>
            );
          })}
        </div>
      )}

      {nextCursor && !loading && (
        <div className="flex justify-center mt-6">
          <button
            onClick={() => load(false, nextCursor)}
            disabled={loadingMore}
            className="px-5 py-2.5 bg-white border border-surface-border rounded-xl text-sm font-semibold hover:bg-surface-sunken transition disabled:opacity-50"
          >
            {loadingMore ? 'Načítám…' : 'Načíst starší'}
          </button>
        </div>
      )}

      {composerOpen && (
        <ManualEventComposer
          onClose={() => setComposerOpen(false)}
          onSaved={() => load(true)}
        />
      )}

      {detail && <DetailDrawer item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function DayMarker({ iso }: { iso: string }) {
  return (
    <div className="relative flex md:justify-center py-4">
      <span className="ml-[6px] md:ml-0 relative z-10 bg-ink text-white text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1">
        {new Date(iso).toLocaleDateString('cs-CZ', {
          day: 'numeric', month: 'long', year: 'numeric',
        })}
      </span>
    </div>
  );
}

function TimelineRow({
  item, meta, onOpen,
}: {
  item: StreamItem;
  meta: (typeof TYPES)[number];
  onOpen: () => void;
}) {
  const right = meta.side === 'right';

  return (
    <div className="relative md:grid md:grid-cols-[1fr_40px_1fr] md:items-center py-1.5 pl-12 md:pl-0">
      {/* left cell */}
      <div className={cn('hidden md:flex', right ? 'justify-end opacity-0 pointer-events-none' : 'justify-end')}>
        {!right && <Card item={item} meta={meta} align="right" onOpen={onOpen} />}
      </div>

      {/* the dot */}
      <div className="absolute md:static left-[13px] top-1/2 md:top-auto -translate-y-1/2 md:translate-y-0 flex justify-center">
        <span className={cn('w-3 h-3 rounded-full ring-4 ring-surface', meta.dot)} />
      </div>

      {/* right cell */}
      <div className={cn('hidden md:flex', right ? 'justify-start' : 'justify-start opacity-0 pointer-events-none')}>
        {right && <Card item={item} meta={meta} align="left" onOpen={onOpen} />}
      </div>

      {/* mobile: one column, everything to the right of the line */}
      <div className="md:hidden">
        <Card item={item} meta={meta} align="left" onOpen={onOpen} />
      </div>
    </div>
  );
}

function Card({
  item, meta, align, onOpen,
}: {
  item: StreamItem;
  meta: (typeof TYPES)[number];
  align: 'left' | 'right';
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        'w-full md:max-w-[380px] bg-white border border-surface-border rounded-2xl p-3.5 text-left',
        'hover:border-[#c8d4ea] hover:shadow-[0_2px_12px_rgba(36,59,107,0.08)] transition',
        align === 'right' ? 'md:text-right' : '',
      )}
    >
      <div className={cn('flex items-center gap-2', align === 'right' ? 'md:flex-row-reverse' : '')}>
        <span className={cn('inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5', meta.chip)}>
          {meta.icon}
          {meta.label}
        </span>
        <span className="text-[10.5px] text-ink-faint">
          {new Date(item.occurredAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {item.status && (
          <span className="text-[10px] font-semibold text-ink-muted bg-surface-sunken rounded-full px-2 py-0.5">
            {item.status}
          </span>
        )}
      </div>

      <p className="text-[13.5px] font-semibold text-ink mt-1.5 leading-snug">{item.title}</p>
      {item.subtitle && (
        <p className="text-[11.5px] text-ink-muted mt-1 line-clamp-2">{item.subtitle}</p>
      )}
      {item.propertyName && (
        <p className="text-[10.5px] text-ink-faint mt-1">{item.propertyName}</p>
      )}

      {/* A chat about this cleaning is part of this record, not a line of its
          own — so it shows up here, as a hint that there was talking. */}
      {item.chat && (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 mt-2 text-[10px] font-semibold',
            'text-[#243b6b] bg-[#eef2fa] border border-[#c8d4ea] rounded-full px-2 py-0.5',
          )}
        >
          <MessageSquare size={10} />
          {item.chat.messageCount} zpráv · {item.chat.participantCount} účastníků
        </span>
      )}
    </button>
  );
}

function DetailDrawer({ item, onClose }: { item: StreamItem; onClose: () => void }) {
  // Types with a screen of their own get a link; the rest are read here.
  const href =
    item.type === 'INCIDENT' || item.type === 'REPAIR' || item.type === 'INSPECTION'
      ? `/incidents/${item.source.id}`
      : item.type === 'DIRECT_CHAT'
      ? `/conversations/${item.source.id}`
      : item.type === 'TURNOVER' && item.chat
      // The turnover has no screen of its own, but its chat does.
      ? `/conversations/${item.chat.id}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white h-full shadow-2xl p-5 overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              {(META[item.type] ?? META.MANUAL).label}
            </p>
            <h2 className="text-lg font-bold text-ink mt-1">{item.title}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-surface-sunken flex items-center justify-center">
            <X size={17} />
          </button>
        </div>

        <dl className="mt-5 text-sm divide-y divide-surface-border">
          <Row label="Kdy" value={new Date(item.occurredAt).toLocaleString('cs-CZ')} />
          {item.propertyName && <Row label="Objekt" value={item.propertyName} />}
          {item.status && <Row label="Stav" value={item.status} />}
          {item.priority && <Row label="Priorita" value={item.priority} />}
          {item.subtitle && <Row label="Detail" value={item.subtitle} />}
          {item.chat && (
            <Row
              label="Chat"
              value={`${item.chat.messageCount} zpráv · ${item.chat.participantCount} účastníků${
                item.chat.lastMessage ? ` · ${item.chat.lastMessage}` : ''
              }`}
            />
          )}
          {item.authorName && <Row label="Kdo" value={item.authorName} />}
          <Row label="ID záznamu" value={item.source.id} mono />
        </dl>

        {href && (
          <Link
            href={href}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold"
          >
            Otevřít záznam
            <ExternalLink size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4 py-2.5">
      <dt className="w-28 flex-shrink-0 text-ink-muted text-[12.5px]">{label}</dt>
      <dd className={cn('text-ink text-[12.5px] min-w-0 break-words', mono && 'font-mono text-[11.5px]')}>
        {value}
      </dd>
    </div>
  );
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}
