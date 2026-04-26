#!/usr/bin/env ts-node
/**
 * sync-avantio-to-postgres.ts
 *
 * Delta sync: Avantio PMS API → PostgreSQL
 *
 * Based on production GCP jobs (detail_bookings_delta.py +
 * export_accommodations_to_parquet.py), adapted for direct PostgreSQL upsert.
 *
 * Strategy (matching production):
 *   1) Sync accommodations (full pull, UPSERT on pmsPropertyId)
 *   2) Sync bookings using dual-watermark delta:
 *      a) Sweep 1: bookings by -creationDate in [watermark_created - 5min, now)
 *      b) Sweep 2: bookings by -updatedAt   in [watermark_updated - 5min, now)
 *      c) Union IDs from both sweeps
 *      d) Fetch full detail for each ID via GET /bookings/{id}
 *      e) UPSERT into cleaning_events + handle cancellations
 *   3) Update watermarks on tenant
 *
 * Run modes:
 *   npx ts-node scripts/sync-avantio-to-postgres.ts
 *   TENANT_ID=abc npx ts-node scripts/sync-avantio-to-postgres.ts
 *   DRY_RUN=true npx ts-node scripts/sync-avantio-to-postgres.ts
 *   npm run sync
 *   npm run sync:dry
 *
 * Required env:
 *   DATABASE_URL           PostgreSQL connection string
 *   AVANTIO_API_BASE_URL   https://api.avantio.pro/pms/v2
 *   AVANTIO_API_KEY        X-Avantio-Auth header value
 */

import { PrismaClient, BookingChannel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

// ─── CONFIG ───

const API_BASE = process.env.AVANTIO_API_BASE_URL || 'https://api.avantio.pro/pms/v2';
const API_KEY = process.env.AVANTIO_API_KEY;
if (!API_KEY) throw new Error('AVANTIO_API_KEY is required');

const TENANT_ID = process.env.TENANT_ID || '';
const DRY_RUN = process.env.DRY_RUN === 'true';
const PAGE_SIZE = Math.max(10, Math.min(parseInt(process.env.PAGE_SIZE || '50', 10), 100));
const API_DELAY_MS = parseInt(process.env.API_DELAY_MS || '250', 10);
const LOOKBACK_HOURS = parseInt(process.env.LOOKBACK_HOURS || '24', 10);
const OVERLAP_MINUTES = 5;

// ─── CLIENTS ───

const prisma = new PrismaClient();
const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Avantio-Auth': API_KEY,
  },
  timeout: 30000,
});

// ─── HELPERS ───

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function parseNextCursor(nextUrl?: string): string | undefined {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get('pagination_cursor')
      || url.searchParams.get('pagination[cursor]')
      || url.searchParams.get('paginationCursor')
      || url.searchParams.get('cursor')
      || undefined;
  } catch {
    return undefined;
  }
}

function parseIso(s?: string | null): Date | null {
  if (!s) return null;
  try {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Pad Avantio time strings like "0:00 " → "00:00", "15:00" → "15:00".
 * Handles trailing spaces and single-digit hours.
 */
function sanitizeTime(raw: string | undefined | null, fallback: string): string {
  const t = (raw || fallback).trim();
  return t.match(/^\d:/) ? '0' + t : t;
}

// ─── ACCOMMODATION SYNC ───

interface AccomRow {
  id: string;
  name: string;
  type: string;
  status: string;
  clean: boolean;
}

async function pullAllAccommodations(): Promise<AccomRow[]> {
  const all: AccomRow[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    page++;
    const params: Record<string, any> = {};
    if (cursor) {
      params.pagination_cursor = cursor;
    } else {
      params.pagination_size = PAGE_SIZE;
      params.sort = 'id';
      params.status = 'ENABLED';
    }

    log(`  Accommodations page ${page}${cursor ? ' (cursor)' : ''}`);
    const resp = await api.get('/accommodations', { params });
    const items = Array.isArray(resp.data?.data) ? resp.data.data : [];

    for (const a of items) {
      all.push({
        id: String(a.id),
        name: a.name || `Accommodation ${a.id}`,
        type: a.type || 'OTHER',
        status: a.status || 'ENABLED',
        clean: a.clean ?? false,
      });
    }

    const nextUrl = resp.data?._links?.next;
    cursor = parseNextCursor(nextUrl);
    if (!cursor) {
      if (items.length === PAGE_SIZE) log('  WARNING: Full page but no next cursor');
      break;
    }
    await sleep(API_DELAY_MS);
  }

  return all;
}

async function upsertAccommodations(tenantId: string, items: AccomRow[]) {
  let created = 0, updated = 0;

  for (const a of items) {
    const existing = await prisma.property.findFirst({
      where: { tenantId, pmsPropertyId: a.id },
    });

    if (existing) {
      const changed = existing.name !== a.name
        || existing.accommodationType !== a.type
        || existing.pmsStatus !== a.status
        || existing.pmsClean !== a.clean;
      if (changed && !DRY_RUN) {
        await prisma.property.update({
          where: { id: existing.id },
          data: {
            name: a.name, accommodationType: a.type,
            pmsStatus: a.status, pmsClean: a.clean,
            pmsLastSyncedAt: new Date(),
            isActive: a.status === 'ENABLED',
          },
        });
        updated++;
      }
    } else if (!DRY_RUN) {
      await prisma.property.create({
        data: {
          tenantId, name: a.name, pmsPropertyId: a.id,
          accommodationType: a.type, pmsStatus: a.status,
          pmsClean: a.clean, pmsLastSyncedAt: new Date(),
          isActive: a.status === 'ENABLED',
        },
      });
      created++;
    }
  }

  log(`  Accommodations: ${created} created, ${updated} updated, ${items.length - created - updated} unchanged`);
  return { created, updated, total: items.length };
}

// ─── BOOKING SYNC ───

async function sweepBookingIds(
  fieldName: string,
  extractField: (b: any) => Date | null,
  start: Date,
  end: Date,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    page++;

    const params: Record<string, any> = {};
    if (cursor) {
      params.pagination_cursor = cursor;
    } else {
      params.pagination_size = PAGE_SIZE;
      params.sort = `-${fieldName}`;
    }

    log(`  [${fieldName}] page ${page}${cursor ? ' (cursor)' : ''}`);
    const resp = await api.get('/bookings', { params });
    const items = Array.isArray(resp.data?.data) ? resp.data.data : [];

    let oldestOnPage: Date | null = null;
    let keptCount = 0;

    for (const b of items) {
      const ts = extractField(b);
      if (!ts) continue;

      if (ts >= start && ts < end) {
        ids.add(String(b.id));
        keptCount++;
      }

      if (!oldestOnPage || ts < oldestOnPage) {
        oldestOnPage = ts;
      }
    }

    log(`    fetched=${items.length}, kept=${keptCount}, oldest=${oldestOnPage?.toISOString() || 'n/a'}`);

    const nextUrl = resp.data?._links?.next;
    cursor = parseNextCursor(nextUrl);

    if (!cursor || (oldestOnPage && oldestOnPage < start)) {
      break;
    }

    await sleep(API_DELAY_MS);
  }

  return ids;
}

function extractCreatedAt(b: any): Date | null {
  return parseIso(b.creationDate) || parseIso(b.createdAt) || parseIso(b.created_at) || null;
}

function extractUpdatedAt(b: any): Date | null {
  return parseIso(b.updatedAt) || parseIso(b.updated_at) || null;
}

async function fetchAndUpsertBooking(tenantId: string, bookingId: string, index: number, total: number) {
  await sleep(API_DELAY_MS);

  let detail: any;
  try {
    const resp = await api.get(`/bookings/${bookingId}`);
    detail = resp.data?.data || resp.data;
  } catch (err: any) {
    if (err.response?.status === 404) {
      log(`  (${index}/${total}) Booking ${bookingId}: 404 — skipping`);
      return 'skipped';
    }
    throw err;
  }

  // ── Resolve property ──
  const pmsPropertyId = String(detail.accommodation?.id || '');
  const property = await prisma.property.findFirst({
    where: { tenantId, pmsPropertyId },
  });
  if (!property) {
    log(`  (${index}/${total}) Booking ${bookingId}: No property for accommodation ${pmsPropertyId} — skipping`);
    return 'skipped';
  }

  // ── Parse fields ──
  const arrival = detail.stayDates?.arrival;
  const departure = detail.stayDates?.departure;
  if (!arrival || !departure) return 'skipped';

  // Sanitize times: "0:00 " → "00:00", "15:00" stays "15:00"
  const cleanIn = sanitizeTime(detail.checkInTime, '15:00');
  const cleanOut = sanitizeTime(detail.checkOutTime, '10:00');

  // Build full ISO datetimes and convert to Date objects
  const checkInDate = new Date(`${arrival}T${cleanIn}:00.000Z`);
  const checkOutDate = new Date(`${departure}T${cleanOut}:00.000Z`);

  // Validate dates — skip if invalid
  if (isNaN(checkInDate.getTime())) {
    log(`  (${index}/${total}) Booking ${bookingId}: Invalid checkInTime "${detail.checkInTime}" → skipping`);
    return 'skipped';
  }
  if (isNaN(checkOutDate.getTime())) {
    log(`  (${index}/${total}) Booking ${bookingId}: Invalid checkOutTime "${detail.checkOutTime}" → skipping`);
    return 'skipped';
  }

  const bookingRef = detail.reference || String(detail.id);
  const numAdults = detail.occupancy?.adults || 1;
  const numChildren = Array.isArray(detail.occupancy?.children) ? detail.occupancy.children.length : 0;
  const channel = detail.salesChannel?.name || 'Other';
  const statusRaw = String(detail.status || '').toUpperCase();
  const isCancelled = ['CANCELLED', 'CANCELED', 'DELETED', 'NO_SHOW'].includes(statusRaw);

  // ── Check existing ──
  const existing = await prisma.cleaningEvent.findFirst({
    where: { tenantId, pmsBookingId: bookingId },
    include: { assignments: true },
  });

  // ── Handle cancellation ──
  if (isCancelled) {
    if (existing && existing.status !== 'CANCELLED') {
      if (!DRY_RUN) {
        await prisma.cleaningEvent.update({
          where: { id: existing.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        await prisma.cleaningAssignment.updateMany({
          where: { cleaningEventId: existing.id, status: { in: ['ASSIGNED', 'STARTED'] } },
          data: { status: 'REASSIGNED' },
        });
        for (const a of existing.assignments.filter(a => ['ASSIGNED', 'STARTED'].includes(a.status))) {
          await prisma.notification.create({
            data: {
              tenantId, userId: a.userId, type: 'CANCELLATION', channel: 'IN_APP',
              title: 'Cleaning Cancelled',
              body: `Cleaning for ${property.name} (${bookingRef}) was cancelled.`,
              payload: { eventId: existing.id },
            },
          });
        }
      }
      log(`  (${index}/${total}) CANCELLED: ${bookingRef} at ${property.name}`);
      return 'cancelled';
    }
    return 'skipped';
  }

  // ── Update existing ──
  if (existing) {
    const changed = existing.checkInTime.toISOString() !== checkInDate.toISOString()
      || existing.checkOutTime?.toISOString() !== checkOutDate.toISOString()
      || existing.numAdults !== numAdults
      || existing.numChildren !== numChildren
      || existing.accommodationName !== property.name;

    if (changed && !DRY_RUN) {
      await prisma.cleaningEvent.update({
        where: { id: existing.id },
        data: {
          checkInTime: checkInDate,
          checkOutTime: checkOutDate,
          accommodationName: property.name,
          accommodationType: property.accommodationType,
          numAdults, numChildren,
          channel: mapChannel(channel),
          pmsLastSyncedAt: new Date(),
          pmsRawData: detail,
        },
      });
      for (const a of existing.assignments.filter(a => ['ASSIGNED', 'STARTED'].includes(a.status))) {
        await prisma.notification.create({
          data: {
            tenantId, userId: a.userId, type: 'BOOKING_MODIFIED', channel: 'IN_APP',
            title: 'Booking Updated',
            body: `Details changed for ${property.name} (${bookingRef}).`,
            payload: { eventId: existing.id },
          },
        });
      }
      log(`  (${index}/${total}) UPDATED: ${bookingRef} at ${property.name}`);
      return 'updated';
    }
    return 'skipped';
  }

  // ── Create new event ──
  if (!DRY_RUN) {
    const timeSlot = checkOutDate.getTime() > 0
      ? checkOutDate
      : new Date(checkInDate.getTime() - 3 * 3600 * 1000);

    const event = await prisma.cleaningEvent.create({
      data: {
        tenantId,
        propertyId: property.id,
        bookingRef,
        pmsBookingId: bookingId,
        checkInTime: checkInDate,
        checkOutTime: checkOutDate,
        accommodationName: property.name,
        accommodationType: property.accommodationType,
        numAdults, numChildren,
        channel: mapChannel(channel),
        cleaningType: 'CHECKOUT',
        status: property.defaultCleanerId ? 'ASSIGNED' : 'PENDING',
        timeSlot,
        pmsLastSyncedAt: new Date(),
        pmsRawData: detail,
      },
    });

    if (property.defaultCleanerId) {
      await prisma.cleaningAssignment.create({
        data: {
          cleaningEventId: event.id,
          userId: property.defaultCleanerId,
          isPrimary: true,
          status: 'ASSIGNED',
        },
      });
      await prisma.notification.create({
        data: {
          tenantId, userId: property.defaultCleanerId,
          type: 'NEW_ASSIGNMENT', channel: 'IN_APP',
          title: 'New Cleaning',
          body: `New cleaning: ${property.name} (${bookingRef})`,
          payload: { eventId: event.id },
        },
      });
    }
  }
  log(`  (${index}/${total}) CREATED: ${bookingRef} at ${property.name}${property.defaultCleanerId ? ' (auto-assigned)' : ''}`);
  return 'created';
}

function mapChannel(ch: string): BookingChannel {
  const l = ch.toLowerCase();
  if (l.includes('airbnb')) return 'AIRBNB';
  if (l.includes('booking')) return 'BOOKING_COM';
  if (l.includes('vrbo')) return 'VRBO';
  if (l.includes('expedia')) return 'EXPEDIA';
  if (l.includes('direct')) return 'DIRECT';
  return 'OTHER';
}

// ─── MAIN ───

async function syncTenant(tenant: any) {
  const now = new Date();
  log(`\n═══ Tenant: ${tenant.name} ═══`);

  log('\n[Step 1] Pulling accommodations...');
  const accommodations = await pullAllAccommodations();
  log(`  Fetched ${accommodations.length} accommodations`);
  await upsertAccommodations(tenant.id, accommodations);

  log('\n[Step 2] Booking delta sync...');

  const settings = (tenant.settings as any) || {};
  const lastCreated = parseIso(settings.lastSyncCreatedIso) || tenant.pmsLastSyncAt;
  const lastUpdated = parseIso(settings.lastSyncUpdatedIso) || tenant.pmsLastSyncAt;

  const defaultLookback = new Date(now.getTime() - LOOKBACK_HOURS * 3600 * 1000);
  const overlap = OVERLAP_MINUTES * 60 * 1000;

  const startCreated = new Date((lastCreated || defaultLookback).getTime() - overlap);
  const startUpdated = new Date((lastUpdated || defaultLookback).getTime() - overlap);

  log(`  Window (creationDate): ${startCreated.toISOString()} → ${now.toISOString()}`);
  log(`  Window (updatedAt):    ${startUpdated.toISOString()} → ${now.toISOString()}`);

  log('\n  Sweep 1: creationDate...');
  const createdIds = await sweepBookingIds('creationDate', extractCreatedAt, startCreated, now);
  log(`  → ${createdIds.size} booking IDs from creationDate sweep`);

  log('\n  Sweep 2: updatedAt...');
  const updatedIds = await sweepBookingIds('updatedAt', extractUpdatedAt, startUpdated, now);
  log(`  → ${updatedIds.size} booking IDs from updatedAt sweep`);

  const allIds = new Set([...createdIds, ...updatedIds]);
  log(`\n  Union: ${allIds.size} unique booking IDs to process`);

  if (allIds.size === 0) {
    log('  No bookings to sync');
  } else {
    log('\n[Step 3] Fetching details & upserting...');
    const stats = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
    const sortedIds = [...allIds].sort();

    for (let i = 0; i < sortedIds.length; i++) {
      try {
        const result = await fetchAndUpsertBooking(tenant.id, sortedIds[i], i + 1, sortedIds.length);
        if (result === 'created') stats.created++;
        else if (result === 'updated') stats.updated++;
        else if (result === 'cancelled') stats.cancelled++;
        else stats.skipped++;
      } catch (err: any) {
        log(`  ERROR on booking ${sortedIds[i]}: ${err.message}`);
        stats.skipped++;
      }
    }

    log(`\n  Results: ${stats.created} created, ${stats.updated} updated, ${stats.cancelled} cancelled, ${stats.skipped} skipped`);
  }

  if (!DRY_RUN) {
    const nowIso = now.toISOString();
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        pmsLastSyncAt: now,
        settings: {
          ...(tenant.settings as any || {}),
          lastSyncCreatedIso: nowIso,
          lastSyncUpdatedIso: nowIso,
        },
      },
    });
  }

  log(`\n✅ Tenant ${tenant.name} sync complete`);
}

async function main() {
  log('═══════════════════════════════════════════════');
  log('CleanOps — Avantio → PostgreSQL Delta Sync');
  log(`API: ${API_BASE}`);
  log(`DRY_RUN: ${DRY_RUN}`);
  log(`Overlap: ${OVERLAP_MINUTES} min | Lookback: ${LOOKBACK_HOURS}h`);
  log('═══════════════════════════════════════════════');

  let tenants;
  if (TENANT_ID) {
    const t = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
    tenants = t ? [t] : [];
  } else {
    tenants = await prisma.tenant.findMany({
      where: { isActive: true, pmsSyncEnabled: true },
    });
  }

  if (tenants.length === 0) {
    log('No tenants configured for sync. Exiting.');
    return;
  }

  for (const tenant of tenants) {
    await syncTenant(tenant);
  }

  log('\n═══════════════════════════════════════════════');
  log('All tenants synced. Done.');
  log('═══════════════════════════════════════════════');
}

main()
  .catch(err => { console.error('FATAL:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());