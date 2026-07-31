/**
 * Application time zone.
 *
 * The database stores UTC — that is correct and does not change. What matters
 * is that "today", "this morning" and any HH:mm sent back to the PMS are
 * resolved in the timezone the business actually operates in, not the server's.
 *
 * The bug this replaces: `new Date().toISOString().split('T')[0]` returns the
 * UTC date. Between midnight and 02:00 Prague (01:00 in winter) that is still
 * *yesterday*, so every "today's cleanings" view was wrong for the first hours
 * of each day.
 */
export const APP_TIME_ZONE = 'Europe/Prague';

/**
 * Today's date as YYYY-MM-DD in the application timezone.
 *
 * `sv-SE` is used deliberately: it formats as ISO (2026-07-31) without needing
 * manual padding, and it is stable across ICU versions.
 */
export function todayInAppZone(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: APP_TIME_ZONE });
}

/**
 * HH:mm in the application timezone, for values the PMS interprets as local
 * wall-clock time. `hourCycle: 'h23'` keeps midnight as "00:00" rather than
 * "24:00", which some locales produce.
 */
export function timeInAppZone(input: Date | string): string {
  return new Date(input).toLocaleTimeString('sv-SE', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** Start of the given day (00:00) in the application timezone, as a UTC instant. */
export function startOfDayInAppZone(day: string): Date {
  // Resolve the offset by probing: format the naive instant in the target zone
  // and measure the difference. Same technique as AvantioAdapter.localToUtcIso,
  // and it handles DST without a timezone library.
  const probe = new Date(`${day}T00:00:00Z`);
  const asZoned = new Date(
    probe.toLocaleString('sv-SE', { timeZone: APP_TIME_ZONE }).replace(' ', 'T') + 'Z',
  );
  return new Date(probe.getTime() - (asZoned.getTime() - probe.getTime()));
}
