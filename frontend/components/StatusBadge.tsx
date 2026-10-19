import { cn } from '@/lib/utils';
import type { EventStatus, CleaningType } from '@/lib/api';
import type { Translations } from '@/i18n/translations';

const STATUS_STYLES: Record<EventStatus, string> = {
  PENDING:    'bg-sand-soft text-sand-deep border-transparent',
  ASSIGNED:   'bg-surface-sunken text-ink-soft border-transparent',
  IN_PROGRESS:'bg-accent text-white border-transparent',
  COMPLETED:  'bg-accent-soft text-accent border-transparent',
  CANCELLED:  'bg-surface-sunken text-ink-muted border-transparent',
  FLAGGED:    'bg-coral-soft text-coral-deep border-transparent',
};

const STATUS_DOT: Record<EventStatus, string> = {
  PENDING:    'bg-sand',
  ASSIGNED:   'bg-ink-muted',
  IN_PROGRESS:'bg-white',
  COMPLETED:  'bg-accent',
  CANCELLED:  'bg-ink-faint',
  FLAGGED:    'bg-coral',
};

interface StatusBadgeProps {
  status: EventStatus;
  t: Translations;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, t, size = 'md' }: StatusBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-md border font-semibold',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
      STATUS_STYLES[status] ?? STATUS_STYLES.PENDING,
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[status])} />
      {t.status[status] ?? status}
    </span>
  );
}

const TYPE_STYLES: Record<CleaningType, string> = {
  CHECKOUT: 'bg-sky-50 text-sky-700 border-sky-200',
  MIDSTAY:  'bg-orange-50 text-orange-700 border-orange-200',
  DEEP:     'bg-rose-50 text-rose-700 border-rose-200',
};

const TYPE_ICON: Record<CleaningType, string> = {
  CHECKOUT: '↗',
  MIDSTAY:  '↔',
  DEEP:     '✦',
};

interface TypeBadgeProps {
  type: CleaningType;
  t: Translations;
}

export function TypeBadge({ type, t }: TypeBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium',
      TYPE_STYLES[type] ?? TYPE_STYLES.CHECKOUT,
    )}>
      <span>{TYPE_ICON[type]}</span>
      {t.cleanType[type] ?? type}
    </span>
  );
}

interface ChannelDotProps {
  channel: string;
  label?: string;
}

const CHANNEL_COLORS: Record<string, string> = {
  AIRBNB:     '#FF5A5F',
  BOOKING_COM:'#003580',
  VRBO:       '#3B5998',
  EXPEDIA:    '#FFC72C',
  DIRECT:     '#059669',
  OTHER:      '#9ca3af',
};

export function ChannelDot({ channel, label }: ChannelDotProps) {
  const color = CHANNEL_COLORS[channel] ?? CHANNEL_COLORS.OTHER;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      {label && <span className="text-xs text-ink-muted">{label}</span>}
    </span>
  );
}
