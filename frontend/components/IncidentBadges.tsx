import { cn } from '@/lib/utils';
import type {
  IncidentStatus,
  IncidentPriority,
  IncidentType,
} from '@/lib/api';
import type { Translations } from '@/i18n/translations';

const STATUS_STYLES: Record<IncidentStatus, string> = {
  OPEN:      'bg-red-50 text-red-800 border-red-200',
  SCHEDULED: 'bg-amber-50 text-amber-800 border-amber-200',
  RESOLVED:  'bg-emerald-50 text-emerald-800 border-emerald-200',
  CLOSED:    'bg-stone-100 text-stone-600 border-stone-200',
};

const STATUS_DOT: Record<IncidentStatus, string> = {
  OPEN:      'bg-red-500',
  SCHEDULED: 'bg-amber-500',
  RESOLVED:  'bg-emerald-500',
  CLOSED:    'bg-stone-400',
};

const PRIORITY_STYLES: Record<IncidentPriority, string> = {
  LOW:    'bg-stone-50 text-stone-700 border-stone-200',
  MEDIUM: 'bg-blue-50 text-blue-700 border-blue-200',
  HIGH:   'bg-red-50 text-red-700 border-red-200',
};

const TYPE_STYLES: Record<IncidentType, string> = {
  CLEANING:          'bg-indigo-50 text-indigo-700 border-indigo-200',
  BOILER_INSPECTION: 'bg-orange-50 text-orange-700 border-orange-200',
  ACCIDENT:          'bg-rose-50 text-rose-700 border-rose-200',
  PHOTO_SHOOT:       'bg-violet-50 text-violet-700 border-violet-200',
  REPAIR:            'bg-amber-50 text-amber-700 border-amber-200',
  GENERAL:           'bg-stone-50 text-stone-700 border-stone-200',
};

interface IncidentStatusBadgeProps {
  status: IncidentStatus;
  t: Translations;
  size?: 'sm' | 'md';
}

export function IncidentStatusBadge({ status, t, size = 'md' }: IncidentStatusBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border font-medium',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
      STATUS_STYLES[status],
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[status])} />
      {t.incidents.status[status]}
    </span>
  );
}

interface IncidentPriorityBadgeProps {
  priority: IncidentPriority;
  t: Translations;
}

export function IncidentPriorityBadge({ priority, t }: IncidentPriorityBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium',
      PRIORITY_STYLES[priority],
    )}>
      {t.incidents.priority[priority]}
    </span>
  );
}

interface IncidentTypeBadgeProps {
  type: IncidentType;
  t: Translations;
}

export function IncidentTypeBadge({ type, t }: IncidentTypeBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium',
      TYPE_STYLES[type],
    )}>
      {t.incidents.type[type]}
    </span>
  );
}