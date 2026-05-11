'use client';
import Link from 'next/link';
import { MapPin, Users, Clock, Check, Undo2, AlertTriangle } from 'lucide-react';
import { formatTime } from '@/lib/utils';
import type { CleaningEvent } from '@/lib/api';
import type { Translations } from '@/i18n/translations';

type CardMode = 'pool' | 'mine';

interface CleaningCardProps {
  event: CleaningEvent;
  t: Translations;
  mode: CardMode;
  userId?: string;
  onClaim?: () => void;
  onDrop?: () => void;
  onDone?: () => void;
  claiming?: boolean;
  dropping?: boolean;
  disabled?: boolean;
  incidentCount?: number;
}

const DROP_CUTOFF_HOURS = 12;

function statusAccent(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-300',
    ASSIGNED: 'bg-blue-400',
    IN_PROGRESS: 'bg-violet-500',
    COMPLETED: 'bg-emerald-400',
    CANCELLED: 'bg-stone-300',
    FLAGGED: 'bg-red-500',
  };
  return map[status] ?? 'bg-stone-200';
}

/**
 * Mine-view colour: distinguish the 4 logical states a cleaner cares about.
 *   - COMPLETED     → emerald (done)
 *   - IN_PROGRESS   → blue (currently doing it)
 *   - future ASSIGNED → amber (upcoming, on track)
 *   - past, not completed → red (overdue, unfinished)
 */
function mineAccent(event: CleaningEvent): string {
  if (event.status === 'COMPLETED') return 'bg-emerald-500';
  if (event.status === 'IN_PROGRESS') return 'bg-blue-500';

  const isPast = new Date(event.timeSlot) < new Date();
  if (isPast) return 'bg-red-500';        // past check-in, not done = overdue
  return 'bg-amber-400';                  // future, on track
}

export function CleaningCard({
  event,
  t,
  mode,
  userId,
  onClaim,
  onDrop,
  onDone,
  claiming,
  dropping,
  disabled,
  incidentCount,
}: CleaningCardProps) {
  const activeAssignments = event.assignments.filter(
    (a) => !['REASSIGNED'].includes(a.status),
  );
  const activeCount = activeAssignments.length;
  const slotsLeft = Math.max(0, event.maxCleaners - activeCount);

  const isPast = new Date(event.timeSlot) < new Date();
  const isCompleted = event.status === 'COMPLETED';
  const myAssignment = userId
    ? activeAssignments.find((a) => a.userId === userId)
    : null;

  const hoursUntil =
    (new Date(event.timeSlot).getTime() - Date.now()) / (1000 * 60 * 60);
  const canDrop = hoursUntil >= DROP_CUTOFF_HOURS && !isCompleted;

  return (
    <div
      className={`bg-white rounded-2xl border border-surface-border shadow-card transition-all ${
        isPast || isCompleted ? 'opacity-70' : ''
      }`}
    >
      <div className={`h-1 rounded-t-2xl ${mode === 'mine' ? mineAccent(event) : statusAccent(event.status)}`} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink text-sm leading-snug">
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
            {isCompleted && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                <Check size={12} />
                {t.status.COMPLETED}
              </span>
            )}
            {incidentCount != null && incidentCount > 0 && (
              <Link
                href={`/incidents?cleaningEventId=${event.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full hover:bg-red-100"
              >
                <AlertTriangle size={11} />
                {t.incidents.incidentCount(incidentCount)}
              </Link>
            )}
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap">
          <span className="flex items-center gap-1 font-medium text-ink-soft">
            <Clock size={12} />
            {formatTime(event.timeSlot)}
          </span>
          <span className="flex items-center gap-1">
            <Users size={12} />
            {event.numAdults + event.numChildren}
          </span>
          <span className="text-ink-faint">{t.cleanType[event.cleaningType]}</span>
          {event.maxCleaners > 1 && (
            <span className="text-ink-faint">
              {t.pool.slotsRemaining(slotsLeft, event.maxCleaners)}
            </span>
          )}
        </div>

        {/* Manager note */}
        {event.managerNote && (
          <div className="mt-3">
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 line-clamp-2">
              📝 {event.managerNote}
            </p>
          </div>
        )}

        {/* Actions */}
        {mode === 'pool' && (
          <button
            onClick={onClaim}
            disabled={claiming || disabled || slotsLeft === 0}
            className="mt-4 w-full px-4 py-2.5 bg-ink text-white rounded-xl text-sm font-semibold hover:bg-ink-soft transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {claiming ? t.pool.claiming : t.pool.claim}
          </button>
        )}

        {mode === 'mine' && !isCompleted && !isPast && myAssignment && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={onDrop}
              disabled={dropping || !canDrop}
              title={!canDrop ? t.mine.dropDisabled : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white border border-surface-border text-ink rounded-xl text-sm font-semibold hover:bg-surface-sunken transition disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              <Undo2 size={14} />
              {t.mine.drop}
            </button>
            <button
              onClick={onDone}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition active:scale-[0.98]"
            >
              <Check size={14} />
              {t.mine.done}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}