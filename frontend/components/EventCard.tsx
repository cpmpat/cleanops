'use client';
import { formatTime, formatOccupancy } from '@/lib/utils';
import { StatusBadge, TypeBadge, ChannelDot } from './StatusBadge';
import type { CleaningEvent } from '@/lib/api';
import type { Translations } from '@/i18n/translations';
import { MapPin, Users, Clock } from 'lucide-react';

interface EventCardProps {
  event: CleaningEvent;
  t: Translations;
  onClick?: () => void;
  isManager?: boolean;
  compact?: boolean;
}

export function EventCard({ event, t, onClick, isManager, compact }: EventCardProps) {
  const primaryAssignee = event.assignments.find(a => a.isPrimary);
  const assigneeCount = event.assignments.filter(
    a => !['REASSIGNED'].includes(a.status)
  ).length;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-surface-border shadow-card hover:shadow-card-hover hover:border-ink-faint transition-all duration-200 active:scale-[0.99] group"
    >
      {/* Top accent bar based on status */}
      <div className={`h-1 rounded-t-2xl ${statusAccent(event.status)}`} />

      <div className={compact ? 'p-3' : 'p-4'}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink text-sm leading-snug truncate">
              {event.accommodationName}
            </p>
            {event.property?.address && (
              <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-1 truncate">
                <MapPin size={10} className="flex-shrink-0" />
                {event.property.address}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <StatusBadge status={event.status} t={t} size="sm" />
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          {/* Time slot */}
          <span className="flex items-center gap-1 font-medium text-ink-soft">
            <Clock size={12} />
            {formatTime(event.timeSlot)}
          </span>

          {/* Guests */}
          <span className="flex items-center gap-1">
            <Users size={12} />
            {formatOccupancy(event.numAdults, event.numChildren)}
          </span>

          {/* Channel dot */}
          <ChannelDot channel={event.channel} label={t.channel[event.channel] ?? event.channel} />

          {/* Type badge */}
          <TypeBadge type={event.cleaningType} t={t} />
        </div>

        {/* Manager: show assignee info */}
        {isManager && (
          <div className="mt-2.5 pt-2.5 border-t border-surface-border flex items-center justify-between">
            {assigneeCount === 0 ? (
              <span className="text-xs text-amber-600 font-medium">⚠ {t.event.noAssignee}</span>
            ) : (
              <span className="text-xs text-ink-muted">
                {primaryAssignee?.user.name}
                {assigneeCount > 1 && ` +${assigneeCount - 1}`}
              </span>
            )}
            <span className="text-xs text-ink-faint font-mono">{event.bookingRef}</span>
          </div>
        )}

        {/* Cleaner: show note if present */}
        {!isManager && event.managerNote && (
          <div className="mt-2.5 pt-2.5 border-t border-surface-border">
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 line-clamp-1">
              📝 {event.managerNote}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}

function statusAccent(status: string): string {
  const map: Record<string, string> = {
    PENDING:    'bg-amber-300',
    ASSIGNED:   'bg-blue-400',
    IN_PROGRESS:'bg-violet-500',
    COMPLETED:  'bg-emerald-400',
    CANCELLED:  'bg-stone-300',
    FLAGGED:    'bg-red-500',
    REJECTED:   'bg-red-400',
  };
  return map[status] ?? 'bg-stone-200';
}
