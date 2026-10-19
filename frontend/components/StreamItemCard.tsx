'use client';
import Link from 'next/link';
import {
  Calendar,
  Sparkles,
  AlertTriangle,
  Wrench,
  ClipboardCheck,
  StickyNote,
  RefreshCw,
  MessagesSquare,
  ArrowUpDown,
} from 'lucide-react';
import { SignedImage } from './SignedImage';
import type { StreamItem, StreamItemType } from '@/lib/api';

const ICONS: Record<StreamItemType, any> = {
  RESERVATION: Calendar,
  CLEANING: Sparkles,
  INCIDENT: AlertTriangle,
  REPAIR: Wrench,
  INSPECTION: ClipboardCheck,
  MANUAL: StickyNote,
  // A turnover is the unit of work; CLEANING above is the legacy row it
  // replaces, kept until those are retired.
  TURNOVER: RefreshCw,
  DIRECT_CHAT: MessagesSquare,
  PRICING: ArrowUpDown,
};

/**
 * One tone per record type, shared by the Stream timeline and the per-unit
 * feed (Oct 2026 palette): guests blue, cleanings green, incidents coral,
 * repairs sand, inspections lilac, pricing teal, the rest neutral.
 * `dot` is a background class (timeline dot, filter chip); `chip` is the
 * soft label (background + text).
 */
export const STREAM_TONE: Record<StreamItemType, { dot: string; chip: string }> = {
  RESERVATION: { dot: 'bg-[#2F5DA8]', chip: 'bg-[#E6ECF6] text-[#2F5DA8]' },
  TURNOVER:    { dot: 'bg-accent',    chip: 'bg-accent-soft text-accent' },
  DIRECT_CHAT: { dot: 'bg-ink-soft',  chip: 'bg-surface-sunken text-ink-soft' },
  INCIDENT:    { dot: 'bg-coral',     chip: 'bg-coral-soft text-coral-deep' },
  REPAIR:      { dot: 'bg-sand',      chip: 'bg-sand-soft text-sand-deep' },
  INSPECTION:  { dot: 'bg-[#7A5BA6]', chip: 'bg-[#EFEAF3] text-[#5E4B75]' },
  MANUAL:      { dot: 'bg-[#8A8E88]', chip: 'bg-[#EFEAE0] text-[#5B5446]' },
  PRICING:     { dot: 'bg-[#2E6E73]', chip: 'bg-[#E3EEEE] text-[#2E6E73]' },
  // Legacy rows the turnover replaces, kept until they are retired.
  CLEANING:    { dot: 'bg-[#C9C4BA]', chip: 'bg-surface-sunken text-ink-muted' },
};

/** The UP / DOWN logo in front of a Pricing Group move. */
export function MoveMark({ move, block }: { move?: StreamItem['move']; block?: boolean }) {
  if (move !== 'UP' && move !== 'DOWN') return null;
  return (
    <img
      src={move === 'UP' ? '/brands/up.svg' : '/brands/down.png'}
      alt={move === 'UP' ? 'up' : 'down'}
      title={move === 'UP' ? 'up' : 'down'}
      // Letters on the baseline at cap height; the arrow hangs into the line
      // gap (same sizing as the Newsfeed sentence).
      className={block
        // Beside a truncated line (which would clip anything hanging out of it).
        ? 'h-5 w-auto flex-shrink-0'
        : `inline-block w-auto mr-1.5 align-baseline ${move === 'UP' ? 'h-[1.45em] -mt-[0.75em]' : 'h-[1.25em] -mb-[0.53em]'}`}
    />
  );
}

interface Props {
  item: StreamItem;
  /** Called when user clicks a manual-event card */
  onEditManual?: (item: StreamItem) => void;
  /** Hide the property name (e.g. when viewing per-property feed) */
  hidePropertyName?: boolean;
}

export function StreamItemCard({ item, onEditManual, hidePropertyName }: Props) {
  const Icon = ICONS[item.type];
  const tone = STREAM_TONE[item.type] ?? STREAM_TONE.MANUAL;

  const occurredDate = new Date(item.occurredAt);
  const dateLabel = occurredDate.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });
  const timeLabel = occurredDate.toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-[34px] h-[34px] rounded-[10px] ${tone.chip} flex items-center justify-center`}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ${tone.chip}`}>
              {item.type}
            </span>
            {item.priority && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {item.priority}
              </span>
            )}
            {!hidePropertyName && item.propertyName && (
              <Link
                href={`/streams/${item.propertyId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-ink-muted hover:text-ink truncate"
              >
                {item.propertyName}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <MoveMark move={item.move} block />
            <p className="font-semibold text-sm text-ink truncate">{item.title}</p>
          </div>
          {item.subtitle && (
            <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{item.subtitle}</p>
          )}
          {item.authorName && (
            <p className="text-[11px] text-ink-faint mt-1">by {item.authorName}</p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs text-ink-muted whitespace-nowrap">{dateLabel}</p>
          <p className="font-mono text-[11px] text-ink-muted">{timeLabel}</p>
        </div>
      </div>

      {item.thumbnailUrl && (
        <div className="mt-3 w-32 h-20 rounded-lg bg-surface-sunken overflow-hidden">
          <SignedImage src={item.thumbnailUrl} className="w-full h-full object-cover" />
        </div>
      )}
    </>
  );

  // Source-based interactivity
  if (item.source.kind === 'incident') {
    return (
      <Link
        href={`/incidents/${item.source.id}`}
        className="block bg-white border border-surface-border rounded-xl p-3.5 hover:border-[#D6D0C4] transition"
      >
        {inner}
      </Link>
    );
  }

  if (item.source.kind === 'manual' && onEditManual) {
    return (
      <button
        type="button"
        onClick={() => onEditManual(item)}
        className="w-full text-left bg-white border border-surface-border rounded-xl p-3.5 hover:border-[#D6D0C4] transition"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="bg-white border border-surface-border rounded-xl p-3.5">
      {inner}
    </div>
  );
}
