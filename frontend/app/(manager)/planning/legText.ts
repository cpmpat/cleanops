import type { CheckInLeg } from '@/lib/api';

/** "Francouzská 15, unit F4 - Praha 2" → "Francouzská 15" */
export const street = (name: string) => name.split(',')[0].split(' - ')[0].trim();

/** One line for a leg: what the desk needs to read at a glance. */
export function legLabel(l: CheckInLeg): string {
  if (l.sameBuilding) return 'same building';
  if (l.unknownReason === 'TIME_UNCONFIRMED') {
    return l.travelMinutes !== null ? `${l.travelMinutes} min · time unconfirmed` : 'time unconfirmed';
  }
  if (l.unknownReason === 'NO_COORDINATES') return 'no coordinates';
  const km = l.distanceKm !== null ? ` · ${l.distanceKm} km` : '';
  const g = l.gapMinutes;
  const margin =
    g === null ? ''
    : g < 0 ? ` · ${-g} min late`
    : l.state === 'TIGHT' ? ` · only ${g} min spare`
    : ` · ${g} min spare`;
  return `${l.travelMinutes} min${km}${margin}`;
}

export const legTone: Record<CheckInLeg['state'], string> = {
  OK: 'text-accent',
  TIGHT: 'text-sand-deep',
  IMPOSSIBLE: 'text-coral-deep font-semibold',
  UNKNOWN: 'text-ink-faint',
};
