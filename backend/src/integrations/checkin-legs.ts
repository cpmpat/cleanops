/**
 * The leg check: can an agent get from one check-in to the next in time?
 *
 * One leg only — from the agent's previous check-in that day to this one. No
 * routing API: the travel time is an estimate from coordinates (free), and
 * without coordinates the leg says so instead of guessing. Two units in the
 * same building need no coordinates: the leg is zero.
 */
import { PrismaService } from '../common/prisma.service';
import { timeInAppZone, todayInAppZone } from '../common/time';

/** Minutes an agent spends at a check-in before leaving for the next. */
export const SERVICE_MINUTES = 20;
/** Margin we want left over after travelling. Less than this is TIGHT. */
export const BUFFER_MINUTES = 10;
/** Up to this distance (street km) an agent walks; beyond it, public transport. */
const WALK_MAX_KM = 1.2;
const WALK_KMH = 4.5;
const TRANSIT_KMH = 18;
const TRANSIT_WAIT_MIN = 5;
/** Straight line → streets. */
const DETOUR = 1.4;

export type LegState = 'OK' | 'TIGHT' | 'IMPOSSIBLE' | 'UNKNOWN';
export type LegUnknownReason = 'NO_COORDINATES' | 'TIME_UNCONFIRMED' | null;

export interface Coord { lat: number; lon: number }

export interface LegStop {
  bookingId: string;
  arrival: Date;
  assumed: boolean;
  accommodationName: string;
  coord: Coord | null;
}

export interface Leg {
  fromBookingId: string;
  toBookingId: string;
  fromName: string;
  fromTime: string;
  sameBuilding: boolean;
  distanceKm: number | null;
  travelMinutes: number | null;
  mode: 'SAME_BUILDING' | 'WALK' | 'TRANSIT' | null;
  /** Minutes left after service, travel and buffer. Negative = short. Null when unknown. */
  slackMinutes: number | null;
  /** Minutes between getting there and the guest's arrival. Negative = late by that much. */
  gapMinutes: number | null;
  state: LegState;
  unknownReason: LegUnknownReason;
}

/** "Hartigova 8, unit 105 - Praha 3" → "hartigova 8|praha 3". */
export function buildingKey(accommodationName: string): string {
  const [left, ...rest] = accommodationName.split(' - ');
  const street = left.split(',')[0].trim().toLowerCase().replace(/\s+/g, ' ');
  const city = rest.join(' - ').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${street}|${city}`;
}

export function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Street km and minutes between two points, walking when close, transit otherwise. */
export function estimateTravel(a: Coord, b: Coord): { km: number; minutes: number; mode: 'WALK' | 'TRANSIT' } {
  const km = haversineKm(a, b) * DETOUR;
  if (km <= WALK_MAX_KM) return { km, minutes: Math.ceil((km / WALK_KMH) * 60), mode: 'WALK' };
  return { km, minutes: Math.ceil((km / TRANSIT_KMH) * 60) + TRANSIT_WAIT_MIN, mode: 'TRANSIT' };
}

/** The leg from stop A to the next stop B of the same agent. */
export function computeLeg(a: LegStop, b: LegStop): Leg {
  const sameBuilding = buildingKey(a.accommodationName) === buildingKey(b.accommodationName);
  let km: number | null = null;
  let minutes: number | null = null;
  let mode: Leg['mode'] = null;
  if (sameBuilding) {
    km = 0; minutes = 0; mode = 'SAME_BUILDING';
  } else if (a.coord && b.coord) {
    const t = estimateTravel(a.coord, b.coord);
    km = Math.round(t.km * 10) / 10; minutes = t.minutes; mode = t.mode;
  }

  const base = {
    fromBookingId: a.bookingId,
    toBookingId: b.bookingId,
    fromName: a.accommodationName,
    fromTime: timeInAppZone(a.arrival),
    sameBuilding,
    distanceKm: km,
    travelMinutes: minutes,
    mode,
  };

  // An assumed 15:00 must not turn a leg red: say "unconfirmed", not "impossible".
  if (a.assumed || b.assumed) {
    return { ...base, slackMinutes: null, gapMinutes: null, state: 'UNKNOWN', unknownReason: 'TIME_UNCONFIRMED' };
  }
  if (minutes === null) {
    return { ...base, slackMinutes: null, gapMinutes: null, state: 'UNKNOWN', unknownReason: 'NO_COORDINATES' };
  }
  const arrivesAt = a.arrival.getTime() + (SERVICE_MINUTES + minutes) * 60_000;
  const gap = Math.floor((b.arrival.getTime() - arrivesAt) / 60_000);
  const state: LegState = gap < 0 ? 'IMPOSSIBLE' : gap < BUFFER_MINUTES ? 'TIGHT' : 'OK';
  return { ...base, slackMinutes: gap - BUFFER_MINUTES, gapMinutes: gap, state, unknownReason: null };
}

/**
 * Legs for every agent's day: stops grouped by agent and Prague day, ordered
 * by arrival. Returns, per booking, the leg that ends at it.
 */
export function legsInto(stops: Array<LegStop & { agentId: string }>): Map<string, Leg> {
  const groups = new Map<string, Array<LegStop & { agentId: string }>>();
  for (const s of stops) {
    const key = `${s.agentId}|${todayInAppZone(s.arrival)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out = new Map<string, Leg>();
  for (const list of groups.values()) {
    list.sort((x, y) => x.arrival.getTime() - y.arrival.getTime());
    for (let i = 1; i < list.length; i++) out.set(list[i].bookingId, computeLeg(list[i - 1], list[i]));
  }
  return out;
}

// ─── Coordinates ──────────────────────────────────────────────────────────────

/** Column names we accept for the coordinates in cdm_accommodations, first match wins. */
const LAT_NAMES = ['latitude', 'lat'];
const LON_NAMES = ['longitude', 'lon', 'lng', 'long'];
let columnCache: { at: number; lat: string | null; lon: string | null } | null = null;

/** Prague and the rest of Czechia, generously. A point outside is a typo, not an address. */
function plausible(c: Coord): boolean {
  return c.lat >= 48 && c.lat <= 52 && c.lon >= 12 && c.lon <= 19;
}

/**
 * Coordinates per Avantio accommodation id, from cdm_accommodations.
 *
 * The latitude/longitude columns are being added to the sheet; until they
 * exist this returns an empty map and every leg between different buildings
 * reads "no coordinates". When they appear (named latitude/longitude or
 * lat/lon), they are picked up within ten minutes, no deploy needed.
 */
export async function loadCoordinates(
  prisma: PrismaService,
  tenantId: string,
  pmsIds: string[],
): Promise<Map<string, Coord>> {
  const out = new Map<string, Coord>();
  if (!pmsIds.length) return out;
  try {
    if (!columnCache || Date.now() - columnCache.at > 10 * 60_000) {
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'cdm_accommodations'`;
      const names = new Set(cols.map((c) => c.column_name));
      columnCache = {
        at: Date.now(),
        lat: LAT_NAMES.find((n) => names.has(n)) ?? null,
        lon: LON_NAMES.find((n) => names.has(n)) ?? null,
      };
    }
    const { lat, lon } = columnCache;
    if (!lat || !lon) return out;
    // Column names come from the allow-lists above, never from input.
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; lat: unknown; lon: unknown }>>(
      `SELECT "idAvantio" AS id, "${lat}"::text AS lat, "${lon}"::text AS lon
         FROM cdm_accommodations
        WHERE "tenantId" = $1 AND "idAvantio" = ANY($2::text[])`,
      tenantId,
      pmsIds,
    );
    for (const r of rows) {
      const c = { lat: parseFloat(String(r.lat ?? '').replace(',', '.')), lon: parseFloat(String(r.lon ?? '').replace(',', '.')) };
      if (Number.isFinite(c.lat) && Number.isFinite(c.lon) && plausible(c)) out.set(r.id, c);
    }
  } catch {
    // Coordinates are a nice-to-have: a failure here must never break Planning.
  }
  return out;
}
