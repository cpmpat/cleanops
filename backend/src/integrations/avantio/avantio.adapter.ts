import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  PmsAdapter, PmsBooking, PmsAccommodation, PmsTenantConfig,
} from '../../common/interfaces/pms-adapter.interface';
import { timeInAppZone } from '../../common/time';

/**
 * Avantio PMS Adapter
 *
 * API Base: https://api.avantio.pro/pms/v2
 * Auth:     X-Avantio-Auth header
 *
 * Endpoints:
 *   GET  /accommodations         → list accommodations (cursor pagination)
 *   GET  /accommodations/{id}    → single accommodation
 *   GET  /bookings               → list bookings — IDs only, no accommodation field
 *   GET  /bookings/{id}          → single booking — full object including accommodation
 *   PUT  /bookings/{id}          → update checkInTime / checkOutTime
 *
 * PAGINATION (critical — learned from production script):
 *   - First request:  send pagination_size + sort + filters
 *   - Next pages:     send ONLY pagination_cursor (no other params!)
 *   - Cursor lives in response._links.next URL, extract via query string
 *   - If _links.next is absent → last page
 *
 * DATES vs TIMES:
 *   - stayDates.arrival / departure = date only ("2026-01-04")
 *   - checkInTime / checkOutTime = time only ("15:00")
 *   - Full datetime = date + "T" + time + ":00.000Z"
 *
 * KNOWN QUIRK — list vs single-resource responses:
 *   GET /bookings (list) never returns the `accommodation` field regardless
 *   of booking status. GET /bookings/{id} always returns it.
 *   pullBookings() therefore uses a two-step approach:
 *     1. Page through the list to collect IDs
 *     2. Fetch each full booking by ID in concurrent batches
 */

// ─── Avantio Raw Types ───

interface AvantioAccommodationRaw {
  id: string;
  name: string;
  type: string;        // "STUDIO", "APARTMENT", "VILLA", etc.
  status: string;      // "ENABLED", "DISABLED", "DELETED"
  clean: boolean;
  _links?: Record<string, string>;
}

export interface AvantioBookingRaw {
  id: string;
  reference: string;
  agentReference?: string;
  stayDates: { arrival: string; departure: string };
  status: string;
  salesChannel?: { name: string };
  createdAt: string;
  updatedAt: string;
  // Only present when fetched via GET /bookings/{id} — never in list responses.
  accommodation?: { id: string; userId?: string };
  occupancy?: {
    adults?: number;
    /**
     * NOT one entry per child. Each element is an age GROUP: `amount` is how
     * many children are in it, `age` is the bracket Avantio/the channel
     * reports for that group. `[{ amount: 3, age: 12 }]` is THREE children.
     */
    children?: Array<{ amount?: number; age?: number }>;
    /** Present in the API, not yet surfaced in the product. */
    infants?: number;
  };
  customer?: {
    name?: string;
    surnames?: string[];
    contact?: {
      emails?: Array<{ address?: string }>;
      phones?: Array<{ number?: string; type?: string }>;
    };
  };
  checkInTime?: string;
  checkOutTime?: string;
  checkIn?: { done: boolean; status: string };
  checkOut?: { status: string };
  comments?: { customer?: string; company?: string };
  extras?: Array<{ info?: { name?: string; category?: { code?: string } } }>;
  tags?: string[];
}

/**
 * Derive head counts from an Avantio `occupancy` object.
 *
 * The subtle part is `children`. It is an array of age GROUPS, each with an
 * `amount`, not an array of individual children — so the count is the sum of
 * `amount`, never `children.length`. Using `.length` undercounts every booking
 * where a group holds more than one child, which is the common case:
 * `{ adults: 2, children: [{ amount: 2, age: 12 }] }` is a party of 4, but
 * `.length` reports 1 child and the card renders "3".
 *
 * Exported so scripts recompute occupancy exactly the way the sync does.
 */
export function parseOccupancy(
  occupancy: AvantioBookingRaw['occupancy'],
): { numAdults: number; numChildren: number } {
  // `?? 1`, not `|| 1`: only a MISSING value falls back to 1. A raw `adults: 0`
  // is reported as 0 — it is what Avantio holds, and inventing a guest to
  // replace it hides bookings whose occupancy was never filled in. The old
  // `|| 1` rewrote those zeros to 1 and made unknown occupancy indistinguishable
  // from a real single-adult stay.
  const numAdults =
    typeof occupancy?.adults === 'number' && Number.isFinite(occupancy.adults)
      ? occupancy.adults
      : 1;

  const numChildren = Array.isArray(occupancy?.children)
    ? occupancy.children.reduce((sum, group) => {
        // A group with no `amount` still describes at least one child.
        const amount = typeof group?.amount === 'number' && Number.isFinite(group.amount)
          ? group.amount
          : 1;
        return sum + Math.max(0, amount);
      }, 0)
    : 0;

  return { numAdults, numChildren };
}

interface AvantioResponse<T> {
  data: T | T[];
  _links?: { self?: string; next?: string; prev?: string };
  meta?: Record<string, any>;
}

/** Delay between paginated list requests and between fetch batches (ms) */
const API_DELAY_MS = 250;

/** How many GET /bookings/{id} requests to fire concurrently */
const FETCH_CONCURRENCY = 5;

@Injectable()
export class AvantioAdapter implements PmsAdapter {
  private readonly logger = new Logger(AvantioAdapter.name);

  private createClient(config: PmsTenantConfig): AxiosInstance {
    return axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Avantio-Auth': config.apiKey,
        ...config.additionalHeaders,
      },
      timeout: 30000,
    });
  }

  /**
   * Extract pagination_cursor from a _links.next URL.
   *
   * _links.next might look like:
   *   "https://api.avantio.pro/pms/v2/accommodations?pagination_cursor=eyJ..."
   *
   * Returns the cursor string or undefined if no next page.
   */
  private parseNextCursor(nextUrl?: string): string | undefined {
    if (!nextUrl) return undefined;
    try {
      const url = new URL(nextUrl);
      return url.searchParams.get('pagination_cursor') || undefined;
    } catch {
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════
  // ACCOMMODATIONS — GET /accommodations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Pull all ENABLED accommodations from Avantio.
   *
   * Pagination rules (from production):
   *   - First page: send pagination_size, sort, status filter
   *   - Subsequent pages: send ONLY pagination_cursor (Avantio rejects
   *     pagination_size when cursor is present)
   *   - Next cursor is in response._links.next URL query param
   */
  async pullAccommodations(config: PmsTenantConfig): Promise<PmsAccommodation[]> {
    const client = this.createClient(config);
    const all: PmsAccommodation[] = [];
    const PAGE_SIZE = 100;

    let cursor: string | undefined;
    let page = 0;

    while (true) {
      page++;

      const params: Record<string, any> = {};
      if (cursor) {
        // CRITICAL: When using cursor, do NOT send pagination_size or other filters
        params.pagination_cursor = cursor;
      } else {
        params.pagination_size = PAGE_SIZE;
        params.sort = 'id';
        params.status = 'ENABLED';
      }

      try {
        this.logger.log(`Accommodations page ${page}${cursor ? ' (cursor)' : ''}`);

        const response = await client.get<AvantioResponse<AvantioAccommodationRaw[]>>('/accommodations', { params });
        const items: AvantioAccommodationRaw[] = Array.isArray(response.data.data)
          ? response.data.data as AvantioAccommodationRaw[]
          : [];

        for (const raw of items) {
          all.push({
            pmsId: String(raw.id),
            name: raw.name,
            type: raw.type || 'OTHER',
            status: raw.status || 'ENABLED',
            clean: raw.clean ?? false,
            rawData: raw,
          });
        }

        const nextUrl = (response.data as any)._links?.next;
        cursor = this.parseNextCursor(nextUrl);

        if (!cursor) {
          if (items.length === PAGE_SIZE) {
            this.logger.warn('Full page returned but no next cursor — possible pagination issue');
          }
          break;
        }

        await this.sleep(API_DELAY_MS);
      } catch (err) {
        if (axios.isAxiosError(err)) {
          this.logger.error(`GET /accommodations page ${page} failed: ${err.response?.status} - ${JSON.stringify(err.response?.data)}`);
        }
        throw err;
      }
    }

    this.logger.log(`Pulled ${all.length} accommodations from Avantio`);
    return all;
  }

  /**
   * Fetch a single accommodation by ID from GET /accommodations/{id}.
   * Used by BookingSyncService.resolveProperty() when a booking references
   * an accommodation that wasn't present in the last accommodations sync
   * (e.g. DISABLED units, or newly created ones).
   *
   * Returns null if the accommodation doesn't exist or the request fails.
   */
  async getAccommodation(accommodationId: string, config: PmsTenantConfig): Promise<PmsAccommodation | null> {
    const client = this.createClient(config);
    try {
      const response = await client.get<AvantioResponse<AvantioAccommodationRaw>>(
        `/accommodations/${accommodationId}`,
      );
      const raw = response.data.data as AvantioAccommodationRaw;
      if (!raw?.id) return null;

      return {
        pmsId: String(raw.id),
        name: raw.name,
        type: raw.type || 'OTHER',
        status: raw.status || 'ENABLED',
        clean: raw.clean ?? false,
        rawData: raw,
      };
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.warn(
          `GET /accommodations/${accommodationId} failed: ` +
          `${err.response?.status} - ${JSON.stringify(err.response?.data)}`,
        );
      }
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOKINGS — GET /bookings + GET /bookings/{id}
  // ═══════════════════════════════════════════════════════════════

  /**
   * Pull bookings modified since `since` using a two-step approach:
   *
   *  Step 1 — Collect IDs:
   *    Page through GET /bookings to collect all booking IDs. The list
   *    endpoint intentionally omits `accommodation` and other fields, so
   *    we treat it purely as an ID source.
   *
   *  Step 2 — Fetch full details in concurrent batches:
   *    For each ID, call GET /bookings/{id} which always returns the full
   *    object including accommodation. Requests run FETCH_CONCURRENCY at
   *    a time with a brief pause between batches.
   *
   * At FETCH_CONCURRENCY=5 and ~250ms per batch, 500 bookings ≈ 25 seconds.
   */
  async pullBookings(since: Date, config: PmsTenantConfig): Promise<PmsBooking[]> {
    const client = this.createClient(config);

    // ── Step 1: collect all booking IDs from the list endpoint ──
    const bookingIds = await this.collectBookingIds(since, client);
    this.logger.log(`Collected ${bookingIds.length} booking IDs — fetching full details`);

    if (bookingIds.length === 0) {
      this.logger.log('No bookings to fetch');
      return [];
    }

    // ── Step 2: fetch full booking details in concurrent batches ──
    const all: PmsBooking[] = [];

    for (let i = 0; i < bookingIds.length; i += FETCH_CONCURRENCY) {
      const batch = bookingIds.slice(i, i + FETCH_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(id => this.fetchFullBookingRaw(id, client)),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(`Failed to fetch booking detail: ${result.reason?.message}`);
          continue;
        }
        try {
          all.push(this.mapBooking(result.value));
        } catch (err) {
          this.logger.warn(`Failed to map booking ${result.value?.id}: ${err.message}`);
        }
      }

      // Brief pause between batches — skip after the last one
      if (i + FETCH_CONCURRENCY < bookingIds.length) {
        await this.sleep(API_DELAY_MS);
      }

      // Progress log every 100 bookings
      const fetched = Math.min(i + FETCH_CONCURRENCY, bookingIds.length);
      if (fetched % 100 === 0 || fetched === bookingIds.length) {
        this.logger.log(`Fetched ${fetched}/${bookingIds.length} bookings`);
      }
    }

    this.logger.log(`Pulled ${all.length} bookings from Avantio`);
    return all;
  }

  /**
   * Page through GET /bookings and return all booking IDs.
   * Treats the list endpoint purely as an ID source.
   */
  private async collectBookingIds(since: Date, client: AxiosInstance): Promise<string[]> {
    const ids: string[] = [];
    const PAGE_SIZE = 50;

    let cursor: string | undefined;
    let page = 0;

    while (true) {
      page++;

      const params: Record<string, any> = {};
      if (cursor) {
        params.pagination_cursor = cursor;
      } else {
        params.pagination_size = PAGE_SIZE;
        params.sort = '-updatedAt';
        // Confirmed param name from Avantio docs: updatedAt_from
        // Filters bookings modified after this date (date-time format)
        params.updatedAt_from = since.toISOString();
      }

      try {
        this.logger.log(`Bookings list page ${page} since ${since.toISOString()}${cursor ? ' (cursor)' : ''}`);

        const response = await client.get<AvantioResponse<AvantioBookingRaw[]>>('/bookings', { params });
        const items: AvantioBookingRaw[] = Array.isArray(response.data.data)
          ? response.data.data as AvantioBookingRaw[]
          : [];

        for (const item of items) {
          if (item.id) ids.push(String(item.id));
        }

        const nextUrl = (response.data as any)._links?.next;
        cursor = this.parseNextCursor(nextUrl);

        if (!cursor) break;
        await this.sleep(API_DELAY_MS);
      } catch (err) {
        if (axios.isAxiosError(err)) {
          this.logger.error(
            `GET /bookings list page ${page} failed: ` +
            `${err.response?.status} - ${JSON.stringify(err.response?.data)}`,
          );
        }
        throw err;
      }
    }

    return ids;
  }

  /**
   * Public wrapper over the list endpoint: every booking ID Avantio has touched
   * since `since`. The backfill script diffs this against our bookings table to
   * find what we missed — it needs the IDs without paying for every detail.
   */
  async listBookingIdsUpdatedSince(since: Date, config: PmsTenantConfig): Promise<string[]> {
    return this.collectBookingIds(since, this.createClient(config));
  }

  /**
   * Fetch a single booking's full raw data from GET /bookings/{id}.
   * This is the only endpoint that reliably returns `accommodation`.
   */
  private async fetchFullBookingRaw(
    bookingId: string,
    client: AxiosInstance,
  ): Promise<AvantioBookingRaw> {
    const response = await client.get<AvantioResponse<AvantioBookingRaw>>(`/bookings/${bookingId}`);
    return response.data.data as AvantioBookingRaw;
  }

  async getBooking(bookingId: string, config: PmsTenantConfig): Promise<PmsBooking> {
    const client = this.createClient(config);
    const response = await client.get<AvantioResponse<AvantioBookingRaw>>(`/bookings/${bookingId}`);
    return this.mapBooking(response.data.data as AvantioBookingRaw);
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE BOOKING — PUT /bookings/{id}
  // ═══════════════════════════════════════════════════════════════

  /**
   * PUT /bookings/{id}
   * Body: { checkInTime: "14:30", checkOutTime: "10:00" }
   * Avantio expects HH:mm format.
   */
  async updateBookingTimes(
    pmsBookingId: string,
    data: { checkInTime?: string; checkOutTime?: string },
    config: PmsTenantConfig,
  ): Promise<void> {
    const client = this.createClient(config);

    const payload: Record<string, string> = {};
    if (data.checkInTime) payload.checkInTime = this.toTimeString(data.checkInTime);
    if (data.checkOutTime) payload.checkOutTime = this.toTimeString(data.checkOutTime);
    if (Object.keys(payload).length === 0) return;

    try {
      this.logger.log(`PUT /bookings/${pmsBookingId} → ${JSON.stringify(payload)}`);
      await client.put(`/bookings/${pmsBookingId}`, payload);
      this.logger.log(`Updated booking ${pmsBookingId} in Avantio`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.error(`PUT /bookings/${pmsBookingId} failed: ${err.response?.status} - ${JSON.stringify(err.response?.data)}`);
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST CONNECTION
  // ═══════════════════════════════════════════════════════════════

  async testConnection(config: PmsTenantConfig): Promise<boolean> {
    const client = this.createClient(config);
    try {
      await client.get('/accommodations', { params: { pagination_size: 1 } });
      return true;
    } catch (err) {
      this.logger.error(`Connection test failed: ${err.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FIELD MAPPING
  // ═══════════════════════════════════════════════════════════════

  private mapBooking(raw: AvantioBookingRaw): PmsBooking {
    // accommodation is guaranteed by GET /bookings/{id} but guard anyway
    if (!raw.accommodation?.id) {
      throw new Error(`Booking ${raw.id} has no accommodation reference`);
    }

    const checkInDateTime = this.combineDateAndTime(
      raw.stayDates.arrival, raw.checkInTime || '15:00',
    );
    const checkOutDateTime = this.combineDateAndTime(
      raw.stayDates.departure, raw.checkOutTime || '10:00',
    );
    const guestName = raw.customer
      ? [raw.customer.name, ...(raw.customer.surnames || [])].filter(Boolean).join(' ')
      : undefined;
    const guestEmail = raw.customer?.contact?.emails?.[0]?.address || undefined;
    const channel = raw.salesChannel?.name || 'Other';
    const { numAdults, numChildren } = parseOccupancy(raw.occupancy);

    return {
      pmsBookingId: String(raw.id),
      bookingRef: raw.reference,
      checkInTime: checkInDateTime,
      checkOutTime: checkOutDateTime,
      pmsPropertyId: String(raw.accommodation.id),
      numAdults,
      numChildren,
      channel: this.normalizeChannel(channel),
      status: this.mapStatus(raw.status),
      isOwnerStay: (raw.status || '').toUpperCase() === 'OWNER',
      guestName,
      guestEmail,
      rawData: raw,
    };
  }

  private combineDateAndTime(dateStr: string, timeStr: string): string {
    // Trim whitespace — Avantio sometimes returns "0:00 " (trailing space)
    const cleaned = timeStr.trim();

    // Normalise to HH:mm — pad single-digit hours ("0:00" → "00:00")
    const [rawHour, rawMin = "00"] = cleaned.split(":");
    const hour = rawHour.padStart(2, "0");
    const min = rawMin.slice(0, 2).padStart(2, "0");

    // Avantio returns times in property local timezone (Europe/Prague for Prague Stays).
    // Build the local datetime string and convert to actual UTC ISO with DST awareness.
    const localISO = `${dateStr}T${hour}:${min}:00`;
    return this.localToUtcIso(localISO, 'Europe/Prague');
  }

  /**
   * Convert a naive local datetime string ("YYYY-MM-DDTHH:mm:ss") in the given
   * timezone to a proper UTC ISO string, with DST handled automatically.
   * Uses only built-in Intl APIs — no external timezone library required.
   */
  private localToUtcIso(localISO: string, timeZone: string): string {
    const m = localISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) throw new Error(`Invalid local ISO: ${localISO}`);
    const [, y, mo, d, h, mi, s] = m.map(Number);

    // Treat the local components as if they were UTC — gives us a probe timestamp.
    const probeUtc = Date.UTC(y, mo - 1, d, h, mi, s);

    // Ask Intl: at this probe timestamp, what time does the target timezone display?
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(probeUtc));
    const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value, 10);

    // What Intl shows for the target tz, expressed back as UTC ms.
    const inTzAsUtc = Date.UTC(
      get('year'), get('month') - 1, get('day'),
      get('hour'), get('minute'), get('second'),
    );

    // The difference is the timezone's offset at that moment (DST-aware).
    const offsetMs = inTzAsUtc - probeUtc;

    // The actual UTC timestamp is the probe MINUS the offset.
    return new Date(probeUtc - offsetMs).toISOString();
  }

  /**
   * Avantio stores times as property-local wall clock, so an ISO instant has to
   * be rendered in the property's timezone. Reading getUTCHours() here sent
   * 13:00Z to Avantio as "13:00" when the manager meant 15:00 Prague — two
   * hours off in summer, one in winter.
   */
  private toTimeString(input: string): string {
    if (input.includes('T')) {
      return timeInAppZone(input);
    }
    return input;
  }

  private normalizeChannel(channel: string): string {
    const l = channel.toLowerCase();
    if (l.includes('airbnb')) return 'Airbnb';
    if (l.includes('booking')) return 'Booking.com';
    if (l.includes('vrbo') || l.includes('homeaway')) return 'VRBO';
    if (l.includes('expedia')) return 'Expedia';
    if (l.includes('direct') || l.includes('website')) return 'Direct';
    return channel;
  }

  /**
   * Map Avantio booking status into our internal three-state model.
   * Avantio returns one of: CONFIRMED, INFORMATION_REQUEST, UNAVAILABLE,
   * UNPAID, CANCELLED, CANCELLED_BY_OWNER, OWNER, UNDER_REQUEST, CONFLICTED.
   */
  private mapStatus(status: string): 'active' | 'cancelled' | 'modified' {
    const s = (status || '').toUpperCase();

    // Real cancellations — booking existed but was cancelled. Notify cleaners/managers.
    if (s === 'CANCELLED' || s === 'CANCELLED_BY_OWNER') return 'cancelled';

    // Active bookings — guest or owner physically present, cleaning required.
    if (s === 'CONFIRMED' || s === 'UNPAID' || s === 'OWNER') return 'active';

    // Non-bookings — inquiries, blocks, conflicts, pending. Skip cleaning creation.
    if (
      s === 'INFORMATION_REQUEST' ||
      s === 'UNAVAILABLE' ||
      s === 'UNDER_REQUEST' ||
      s === 'CONFLICTED'
    ) {
      return 'cancelled';
    }

    // Truly unknown — log loudly and skip rather than create spurious cleanings.
    this.logger.warn(
      `Unknown Avantio booking status "${status}" — skipping (no cleaning will be created). ` +
      `If this is a legitimate booking type, add it to the active list in mapStatus.`,
    );
    return 'cancelled';
  }
}