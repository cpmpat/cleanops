import { atTimeInAppZone, todayInAppZone } from './time';

/**
 * Default arrival time when the PMS gives none (Avantio sends "" or "0:00").
 *
 * Villas open at 16:00, everything else at 15:00 (29 Oct 2026). It is only a
 * placeholder: the booking stays checkInSource FALLBACK, so the desk still sees
 * it as unconfirmed and confirms the real time with the guest, and a time the
 * desk has set (MANAGER) is never replaced by this.
 */
export const DEFAULT_CHECK_IN = '15:00';
export const VILLA_CHECK_IN = '16:00';

export function defaultCheckInFor(accommodationType?: string | null): string {
  return (accommodationType ?? '').trim().toUpperCase() === 'VILLA'
    ? VILLA_CHECK_IN
    : DEFAULT_CHECK_IN;
}

/**
 * The adapter cannot know the unit type, so it always assumes 15:00. Once the
 * property is known, move an assumed arrival to that type's default — same
 * day, Prague time. A real time from the PMS is left alone.
 */
export function withTypeDefaultCheckIn<
  T extends { checkInTime: string; checkInAssumed?: boolean },
>(booking: T, accommodationType?: string | null): T {
  if (!booking.checkInAssumed) return booking;
  const time = defaultCheckInFor(accommodationType);
  if (time === DEFAULT_CHECK_IN) return booking;
  const day = todayInAppZone(new Date(booking.checkInTime));
  return { ...booking, checkInTime: atTimeInAppZone(day, time).toISOString() };
}
