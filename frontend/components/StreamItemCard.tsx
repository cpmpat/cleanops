'use client';
import Link from 'next/link';
import {
  Calendar,
  Sparkles,
  AlertTriangle,
  Wrench,
  ClipboardCheck,
  StickyNote,
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
};

const COLORS: Record<StreamItemType, { bg: string; text: string; border: string }> = {
  RESERVATION: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  CLEANING:    { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  INCIDENT:    { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  REPAIR:      { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  INSPECTION:  { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  MANUAL:      { bg: 'bg-stone-50', text: 'text-stone-700', border: 'border-stone-200' },
};

interface Props {
  item: StreamItem;
  /** Called when user clicks a manual-event card */
  onEditManual?: (item: StreamItem) => void;
  /** Hide the property name (e.g. when viewing per-property feed) */
  hidePropertyName?: boolean;
}

export function StreamItemCard({ item, onEditManual, hidePropertyName }: Props) {
  const Icon = ICONS[item.type];
  const colors = COLORS[item.type];

  const occurredDate = new Date(item.occurredAt);
  const dateLabel = occurredDate.toLocaleDateString();
  const timeLabel = occurredDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full border ${colors.bg} ${colors.text} ${colors.border} flex items-center justify-center`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
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
          <p className="font-semibold text-sm text-ink truncate">{item.title}</p>
          {item.subtitle && (
            <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{item.subtitle}</p>
          )}
          {item.authorName && (
            <p className="text-[11px] text-ink-faint mt-1">by {item.authorName}</p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs text-ink-muted whitespace-nowrap">{dateLabel}</p>
          <p className="text-[11px] text-ink-faint">{timeLabel}</p>
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
        className="block bg-white border border-surface-border rounded-2xl p-4 hover:border-ink-faint transition"
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
        className="w-full text-left bg-white border border-surface-border rounded-2xl p-4 hover:border-ink-faint transition"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="bg-white border border-surface-border rounded-2xl p-4">
      {inner}
    </div>
  );
}
