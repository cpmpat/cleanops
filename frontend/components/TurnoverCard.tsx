'use client';
import Link from 'next/link';
import {
  MapPin, Users, Check, Undo2, AlertTriangle, Moon,
  LogIn, LogOut, Flame, Crown, Clock,
} from 'lucide-react';
import { formatTime } from '@/lib/utils';
import type { Turnover } from '@/lib/api';
import type { Translations } from '@/i18n/translations';

type CardMode = 'pool' | 'mine';

interface TurnoverCardProps {
  turnover: Turnover;
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
    SKIPPED: 'bg-stone-200',
  };
  return map[status] ?? 'bg-stone-200';
}

function mineAccent(turnover: Turnover): string {
  if (turnover.status === 'COMPLETED') return 'bg-emerald-500';
  if (turnover.status === 'IN_PROGRESS') return 'bg-blue-500';
  // Overdue: dueBy passed and not yet completed
  if (turnover.dueBy && new Date(turnover.dueBy) < new Date()) return 'bg-red-500';
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

function calcNights(checkIn?: string, checkOut?: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Days the cleaning has been waiting (today - availableFrom, clamped to 0). */
function calcDaysWaiting(availableFrom: string | null): number {
  if (!availableFrom) return 0;
  const avail = new Date(availableFrom);
  avail.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - avail.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

type PillTone = 'blue' | 'amber' | 'red';

/** Pill color: blue (fresh today), amber (1-2 days waiting), red (3+ days or due soon). */
function pillTone(daysWaiting: number, dueBy: string | null): PillTone {
  if (dueBy) {
    const hoursUntilDue = (new Date(dueBy).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilDue < 24) return 'red';
  }
  if (daysWaiting === 0) return 'blue';
  if (daysWaiting <= 2) return 'amber';
  return 'red';
}

const PILL_CLASSES: Record<PillTone, string> = {
  blue: 'text-sky-700 bg-sky-50 border-sky-200',
  amber: 'text-amber-800 bg-amber-50 border-amber-300',
  red: 'text-red-700 bg-red-50 border-red-300',
};

export function TurnoverCard({
  turnover,
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
}: TurnoverCardProps) {
  const { fromBooking, toBooking, property } = turnover;

  const activeAssignments = turnover.assignments.filter(
    (a) => a.status !== 'REASSIGNED',
  );
  const activeCount = activeAssignments.length;
  const slotsLeft = Math.max(0, turnover.maxCleaners - activeCount);

  const isCompleted = turnover.status === 'COMPLETED';
  const isOverdue =
    !!turnover.dueBy && new Date(turnover.dueBy) < new Date() && !isCompleted;

  const myAssignment = userId
    ? activeAssignments.find((a) => a.userId === userId)
    : null;

  // Drop cutoff — only enforced if dueBy is set (trailing nulls have no deadline)
  let canDrop = !isCompleted;
  if (turnover.dueBy) {
    const hoursUntilDue =
      (new Date(turnover.dueBy).getTime() - Date.now()) / (1000 * 60 * 60);
    canDrop = canDrop && hoursUntilDue >= DROP_CUTOFF_HOURS;
  }

  // Last minute: next guest arrives today AND turnover was created today
  const isLastMinute = (() => {
    if (!toBooking?.checkInTime || isCompleted) return false;
    const checkIn = new Date(toBooking.checkInTime);
    const created = new Date(turnover.createdAt);
    return isToday(checkIn) && isToday(created);
  })();

  // ─── Display fields ───
  const accommodationName =
    property?.name ??
    toBooking?.accommodationName ??
    fromBooking?.accommodationName ??
    '—';

  const bookingRef =
    toBooking?.bookingRef ?? fromBooking?.bookingRef ?? null;

  const guestCount =
    (toBooking?.numAdults ?? 0) + (toBooking?.numChildren ?? 0);

  const nights = calcNights(toBooking?.checkInTime, toBooking?.checkOutTime);

  const daysWaiting = calcDaysWaiting(turnover.availableFrom);
  const tone = pillTone(daysWaiting, turnover.dueBy);

  return (
    <div
      className={`bg-white rounded-2xl border shadow-card transition-all ${
        turnover.isOwnerStay
          ? 'border-amber-300 ring-2 ring-amber-100'
          : isLastMinute
          ? 'border-red-300 ring-2 ring-red-100'
          : 'border-surface-border'
      } ${isOverdue || isCompleted ? 'opacity-70' : ''}`}
    >
      <div
        className={`h-1 rounded-t-2xl ${
          mode === 'mine' ? mineAccent(turnover) : statusAccent(turnover.status)
        }`}
      />

      <div className="p-4">
        {/* Top badges */}
        {(turnover.isOwnerStay || isLastMinute) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {turnover.isOwnerStay && (
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

        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink text-sm leading-snug">
              {accommodationName}
            </p>
            {bookingRef && (
              <p className="text-[11px] text-ink-faint font-mono mt-0.5 truncate">
                {bookingRef}
              </p>
            )}
            {property?.address && (
              <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-1 truncate">
                <MapPin size={10} className="flex-shrink-0" />
                {property.address}
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
                href={`/incidents?turnoverId=${turnover.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full hover:bg-red-100"
              >
                <AlertTriangle size={11} />
                {t.incidents.incidentCount(incidentCount)}
              </Link>
            )}
          </div>
        </div>

        {/* Info row — only when there's a next guest */}
        {toBooking ? (
          <div className="flex items-center gap-3 text-xs text-ink-muted flex-wrap">
            <span className="flex items-center gap-1">
              <Users size={12} />
              {guestCount}
            </span>
            <span className="flex items-center gap-1">
              <LogIn size={12} className="text-ink-faint" />
              <span className="text-ink-faint">Guest arrives</span>
              <span className="font-semibold text-ink-soft">
                {formatTime(toBooking.checkInTime)}
              </span>
            </span>
            {nights !== null && (
              <span className="flex items-center gap-1">
                <Moon size={12} className="text-ink-faint" />
                <span className="text-ink-soft">
                  {nights} {nights === 1 ? 'night' : 'nights'}
                </span>
              </span>
            )}
            {turnover.maxCleaners > 1 && (
              <span className="text-ink-faint">
                {t.pool.slotsRemaining(slotsLeft, turnover.maxCleaners)}
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-ink-muted">
            <span className="italic">Awaiting next booking</span>
            {turnover.maxCleaners > 1 && (
              <span className="text-ink-faint ml-2">
                · {t.pool.slotsRemaining(slotsLeft, turnover.maxCleaners)}
              </span>
            )}
          </div>
        )}

        {/* Last checkout pill with carry-forward escalation */}
        {fromBooking?.checkOutTime ? (
          <div
            className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-full px-2 py-0.5 ${PILL_CLASSES[tone]}`}
          >
            {tone === 'red' ? <Clock size={11} /> : <LogOut size={11} />}
            <span>
              Last checkout{' '}
              {new Date(fromBooking.checkOutTime).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
              , {formatTime(fromBooking.checkOutTime)}
            </span>
            {daysWaiting > 0 && (
              <>
                <span className="opacity-70">·</span>
                <span className="font-bold">
                  {daysWaiting === 1 ? '1 day waiting' : `${daysWaiting} days waiting`}
                </span>
              </>
            )}
            {turnover.dueBy && tone === 'red' && daysWaiting > 0 && (
              <>
                <span className="opacity-70">·</span>
                <span className="font-bold uppercase">Due soon</span>
              </>
            )}
          </div>
        ) : (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium border rounded-full px-2 py-0.5 text-stone-600 bg-stone-50 border-stone-200">
            <LogOut size={11} />
            <span className="italic">No prior booking on record</span>
          </div>
        )}

        {/* Manager note */}
        {turnover.managerNote && (
          <div className="mt-3">
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 line-clamp-2">
              📝 {turnover.managerNote}
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

        {mode === 'mine' && !isCompleted && myAssignment && (
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
