'use client';
import Link from 'next/link';
import { MapPin, Users, Check, Undo2, AlertTriangle, Moon, LogIn, LogOut, Flame, Crown } from 'lucide-react';
import { formatTime, formatOccupancy } from '@/lib/utils';
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

function mineAccent(event: CleaningEvent): string {
  if (event.status === 'COMPLETED') return 'bg-emerald-500';
  if (event.status === 'IN_PROGRESS') return 'bg-blue-500';
  const isPast = new Date(event.timeSlot) < new Date();
  if (isPast) return 'bg-red-500';
  return 'bg-amber-400';
}

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Nights between check-in and check-out. Returns null if missing data. */
function calcNights(checkIn: string | Date, checkOut?: string | Date | null): number | null {
  if (!checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
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

  // ─── Last minute: check-in is today AND booking was created today ───
  const checkInDate = new Date(event.checkInTime);
  const createdDate = new Date(event.createdAt);
  const isLastMinute =
    isToday(checkInDate) && isToday(createdDate) && !isCompleted;

  const nights = calcNights(event.checkInTime, event.checkOutTime);

  return (
    <div
      className={`bg-white rounded-2xl border shadow-card transition-all ${
        event.isOwnerStay
          ? 'border-amber-300 ring-2 ring-amber-100'
          : isLastMinute
          ? 'border-red-300 ring-2 ring-red-100'
          : 'border-surface-border'
      } ${isPast || isCompleted ? 'opacity-70' : ''}`}
    >
      <div className={`h-1 rounded-t-2xl ${mode === 'mine' ? mineAccent(event) : statusAccent(event.status)}`} />

      <div className="p-4">
        {/* Top badges row — Owner stay + Last minute */}
        {(event.isOwnerStay || isLastMinute) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {event.isOwnerStay && (
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900 bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-300 rounded-full px-2.5 py-1 shadow-sm">
                <Crown size={11} className="text-amber-700" />
                Owner stay
              </div>
            )}
            {isLastMinute && (
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1 animate-pulse">
                <Flame size={11} />
                Last minute
              </div>
            )}
          </div>
        )}

        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink text-sm leading-snug">
              {event.accommodationName}
            </p>
            <p className="text-[11px] text-ink-faint font-mono mt-0.5 truncate">
              {event.bookingRef}
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

        {/* Info row — guest count + arrival time + length of stay */}
        <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap">
          <span className="flex items-center gap-1">
            <Users size={12} />
            {formatOccupancy(event.numAdults, event.numChildren)}
          </span>
          <span className="flex items-center gap-1">
            <LogIn size={12} className="text-ink-faint" />
            <span className="text-ink-faint">Guest arrives</span>
            <span className="font-semibold text-ink-soft">{formatTime(event.checkInTime)}</span>
          </span>
          {nights !== null && (
            <span className="flex items-center gap-1">
              <Moon size={12} className="text-ink-faint" />
              <span className="text-ink-soft">{nights} {nights === 1 ? 'night' : 'nights'}</span>
            </span>
          )}
          {event.maxCleaners > 1 && (
            <span className="text-ink-faint">
              {t.pool.slotsRemaining(slotsLeft, event.maxCleaners)}
            </span>
          )}
        </div>

        {/* Last checkout — when the previous guest departed */}
        {(() => {
          if (!event.previousGuestCheckOutTime) return null;
          const prev = new Date(event.previousGuestCheckOutTime);
          const checkIn = new Date(event.checkInTime);
          const ms = checkIn.getTime() - prev.getTime();
          const hours = ms / (1000 * 60 * 60);
          const days = Math.floor(hours / 24);

          const dateLabel = prev.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const gapLabel =
            days === 0 ? `${Math.max(0, Math.round(hours))}h gap` :
            days === 1 ? '1 day idle' :
                         `${days} days idle`;

          return (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-full px-2 py-0.5 text-sky-700 bg-sky-50 border-sky-200">
              <LogOut size={11} />
              <span>Last checkout {dateLabel}, {formatTime(event.previousGuestCheckOutTime)}</span>
              <span className="opacity-70">·</span>
              <span className="font-bold">{gapLabel}</span>
            </div>
          );
        })()}

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
