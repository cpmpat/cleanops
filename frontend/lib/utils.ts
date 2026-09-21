import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The zone the business runs in. Times are shown in it regardless of the device's setting. */
export const APP_TIME_ZONE = 'Europe/Prague';

/**
 * HH:mm in Europe/Prague, 24-hour.
 *
 * Used to follow the browser's zone, so a phone set to another zone — or a
 * laptop on a trip — showed a different arrival time from the desk next to it.
 * Backend `timeInAppZone()` is the same function; keep them identical.
 */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('sv-SE', {
      timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch { return iso; }
}

export function formatDate(iso: string, locale = 'en'): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

/**
 * Today as YYYY-MM-DD in the *viewer's* timezone.
 *
 * toISOString() returns the UTC date, so between midnight and 02:00 Prague this
 * used to report yesterday — "today's cleanings" was wrong for the first hours
 * of every day. `sv-SE` formats as ISO without manual padding.
 */
export function todayISO(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/** Local YYYY-MM-DD for any date — the day-key equivalent of todayISO(). */
export function dayKeyISO(d: Date): string {
  return d.toLocaleDateString('sv-SE');
}

export function channelColor(channel: string): string {
  const map: Record<string, string> = {
    AIRBNB: '#FF5A5F', BOOKING_COM: '#003580', VRBO: '#3B5998',
    EXPEDIA: '#FFC72C', DIRECT: '#059669', OTHER: '#6b7280',
  };
  return map[channel] ?? map.OTHER;
}

/**
 * Party size for the cards, as "adults+children" — e.g. 2 adults and 2 children
 * render as "2+2".
 *
 * A single total hides the composition the cleaner is actually preparing for:
 * "4" reads the same whether it is four adults or two adults and two kids, and
 * those are different bed, towel and amenity setups. The "+" only appears when
 * there are children, so the common all-adult booking still reads as one clean
 * number.
 */
export function formatOccupancy(numAdults?: number | null, numChildren?: number | null): string {
  const adults = numAdults ?? 0;
  const children = numChildren ?? 0;
  return children > 0 ? `${adults}+${children}` : `${adults}`;
}
