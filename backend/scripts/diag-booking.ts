// backend/scripts/diag-booking.ts
//
// READ-ONLY diagnosis of one Avantio booking that is present in the PMS and
// missing (or wrong) locally. Never writes. Never touches pmsLastSyncAt.
//
//   pnpm diag:booking -- --tenant prague-stays --ref A203-HMED24DNKZ [--since 120d]
//   pnpm diag:booking -- --tenant prague-stays --id 33159368 [--window-test]
//
// --id skips the list scan and goes straight to GET /bookings/{id}.
// --window-test then asks the list endpoint, exactly the way the sync does
// (sort=-updatedAt, updatedAt_from=…, cursor pages), whether the booking is
// returned for windows starting just before its updatedAt / createdAt. Absent
// means Avantio never offers it to us; present means we were offered it.
//
// Prints, in order:
//   1. tenant sync state (watermark, enabled, key encrypted?, encryption key present?)
//   2. local rows: Booking / Cleaning / Turnover / PmsSyncFailure / AuditEvent
//   3. the booking as Avantio sees it (list row + GET /bookings/{id})
//   4. whether its accommodation maps to a local property
//   5. where the booking sits relative to the sync windows

import { parseArgs } from 'node:util';
import axios from 'axios';
import { bootScriptContext, resolveTenant, parseSince } from './lib/script-context';
import { pmsConfigFor } from '../src/common/pms-config';
import { isEncrypted, encryptionConfigured } from '../src/common/crypto';

function hr(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}
function j(v: unknown) {
  return JSON.stringify(v, null, 2);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const { values: args } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      ref: { type: 'string' },
      id: { type: 'string' },
      since: { type: 'string', default: '120d' },
      'window-test': { type: 'boolean', default: false },
    },
  });
  if (!args.tenant || (!args.ref && !args.id)) {
    console.error('usage: --tenant <slug|id> (--ref <A203-…> | --id <avantioId>) [--since 120d] [--window-test]');
    process.exit(2);
  }
  const ref = (args.ref ?? '').trim();
  const givenId = (args.id ?? '').trim();

  const ctx = await bootScriptContext({ quiet: true });
  const { prisma } = ctx;
  try {
    const t = await resolveTenant(prisma, args.tenant);
    const tenant = await prisma.tenant.findUnique({ where: { id: t.id } });
    if (!tenant) throw new Error('tenant vanished');

    hr('1. Tenant sync state');
    console.log(j({
      slug: tenant.slug,
      pmsProvider: tenant.pmsProvider,
      pmsSyncEnabled: tenant.pmsSyncEnabled,
      pmsApiBaseUrl: tenant.pmsApiBaseUrl,
      pmsApiKeySet: !!tenant.pmsApiKey,
      pmsApiKeyEncrypted: tenant.pmsApiKey ? isEncrypted(tenant.pmsApiKey) : null,
      CREDENTIALS_ENCRYPTION_KEY_present_in_this_shell: encryptionConfigured(),
      pmsLastSyncAt: tenant.pmsLastSyncAt,
      now: new Date(),
      minutesSinceWatermark: tenant.pmsLastSyncAt
        ? Math.round((Date.now() - tenant.pmsLastSyncAt.getTime()) / 60000)
        : null,
    }));

    const lastSynced = await prisma.booking.findFirst({
      where: { tenantId: t.id, pmsLastSyncedAt: { not: null } },
      orderBy: { pmsLastSyncedAt: 'desc' },
      select: { bookingRef: true, pmsLastSyncedAt: true, createdAt: true },
    });
    const lastCreated = await prisma.booking.findFirst({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'desc' },
      select: { bookingRef: true, pmsLastSyncedAt: true, createdAt: true, checkInTime: true },
    });
    const createdLast14d = await prisma.$queryRaw<Array<{ day: Date; n: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, count(*) AS n
      FROM bookings WHERE "tenantId" = ${t.id} AND "createdAt" >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`;
    console.log('last booking touched by sync:', j(lastSynced));
    console.log('last booking created locally :', j(lastCreated));
    console.log('bookings created per day, last 14d:');
    for (const r of createdLast14d) console.log(`  ${r.day.toISOString().slice(0, 10)}  ${r.n}`);

    hr('2. Local rows for ' + (ref || 'id ' + givenId) + ' — every key, every tenant');
    const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, isActive: true, pmsSyncEnabled: true, pmsLastSyncAt: true } });
    console.log('tenants:', j(tenants));
    // bookingRef, pmsBookingId, and the reference inside the stored raw
    // payload — a row filed under a different name still shows up here.
    const anyKey = await prisma.$queryRaw<any[]>`
      SELECT id, "tenantId", "bookingRef", "pmsBookingId", status, "propertyId",
             "checkInTime", "checkOutTime", "createdAt", "pmsLastSyncedAt", "cancelledAt",
             "pmsRawData"->>'status' AS raw_status, "pmsRawData"->>'reference' AS raw_reference
      FROM bookings
      WHERE "bookingRef" = ${ref} OR "pmsBookingId" = ${ref}
         OR ("pmsBookingId" = ${givenId} AND ${givenId} <> '')
         OR "pmsRawData"->>'reference' = ${ref}
         OR "pmsRawData"->>'agentReference' = ${ref}
      LIMIT 20`;
    if (anyKey.length === 0) console.log('Booking: NONE under any key in any tenant');
    for (const b of anyKey) {
      console.log('Booking:', j(b));
      const turnovers = await prisma.turnover.findMany({
        where: { OR: [{ toBookingId: b.id }, { fromBookingId: b.id }] },
        select: { id: true, status: true, availableFrom: true, dueBy: true, supersededById: true, toBookingId: true, fromBookingId: true },
      });
      console.log('Turnovers:', j(turnovers));
    }
    if (ref) {
      const cleanings = await prisma.cleaning.findMany({ where: { bookingRef: ref }, select: { id: true, tenantId: true, status: true, checkInTime: true, bookingId: true } });
      console.log('Cleanings by bookingRef:', j(cleanings));
    }

    const failures = await prisma.pmsSyncFailure.findMany({ orderBy: { lastFailedAt: 'desc' } });
    console.log(`PmsSyncFailure queue: ${failures.length} row(s)`);
    for (const f of failures.slice(0, 30)) {
      console.log(`  ${f.pmsBookingId}  attempts=${f.attempts}  first=${f.firstFailedAt.toISOString()}  last=${f.lastFailedAt.toISOString()}  ${f.lastError.slice(0, 160)}`);
    }

    const audits = await prisma.$queryRaw<Array<{ createdAt: Date; action: string; metadata: any }>>`
      SELECT "createdAt", action, metadata FROM audit_events
      WHERE "tenantId" = ${t.id} AND (metadata::text ILIKE ${'%' + (ref || givenId) + '%'})
      ORDER BY "createdAt" DESC LIMIT 20`.catch((e) => { console.log('audit query skipped:', e.message); return []; });
    console.log('AuditEvents mentioning it:', audits.length);
    for (const a of audits) console.log(`  ${a.createdAt.toISOString()}  ${a.action}  ${JSON.stringify(a.metadata).slice(0, 200)}`);

    hr('3. Avantio view');
    // The stored key is encrypted with Railway's CREDENTIALS_ENCRYPTION_KEY. If
    // this shell has a different one (the dev key from backend/.env), fall back
    // to AVANTIO_API_KEY from the environment rather than stopping here.
    let config: { apiBaseUrl: string; apiKey: string };
    try {
      const c = pmsConfigFor(tenant);
      if (!c) throw new Error('tenant has no PMS config');
      config = c;
      console.log('Avantio credential: decrypted from tenants.pmsApiKey');
    } catch (e: any) {
      const envKey = process.env.AVANTIO_API_KEY;
      if (!envKey) throw e;
      console.log(`WARN: ${e.message}\n      -> falling back to AVANTIO_API_KEY from the environment`);
      config = { apiBaseUrl: tenant.pmsApiBaseUrl || process.env.AVANTIO_API_BASE_URL || 'https://api.avantio.pro/pms/v2', apiKey: envKey };
    }
    const client = axios.create({
      baseURL: config.apiBaseUrl,
      headers: { Accept: 'application/json', 'X-Avantio-Auth': config.apiKey },
      timeout: 30000,
    });

    // Try a direct filter first (cheap if Avantio supports it), then scan the
    // updatedAt window the sync uses, then a createdAt-sorted scan.
    let listRow: any = null;
    let howFound = '';
    const tryList = async (label: string, firstParams: Record<string, any>, maxPages = 400) => {
      if (listRow) return;
      let cursor: string | undefined;
      let page = 0;
      let seen = 0;
      while (page < maxPages) {
        page++;
        const params: Record<string, any> = cursor ? { pagination_cursor: cursor } : { pagination_size: 50, ...firstParams };
        let res;
        try {
          res = await client.get('/bookings', { params });
        } catch (e: any) {
          console.log(`  [${label}] page ${page} failed: ${e.response?.status} ${JSON.stringify(e.response?.data)?.slice(0, 200)}`);
          return;
        }
        const items: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
        seen += items.length;
        const hit = items.find((x) => x.reference === ref || x.agentReference === ref || String(x.id) === ref);
        if (hit) { listRow = hit; howFound = `${label} (page ${page}, after ${seen} rows)`; return; }
        const next = res.data?._links?.next;
        let nextCursor: string | undefined;
        try { nextCursor = next ? new URL(next).searchParams.get('pagination_cursor') || undefined : undefined; } catch { nextCursor = undefined; }
        if (!nextCursor) { console.log(`  [${label}] scanned ${seen} rows over ${page} page(s), not found`); return; }
        cursor = nextCursor;
        await new Promise((r) => setTimeout(r, 150));
      }
      console.log(`  [${label}] stopped after ${maxPages} pages (${seen} rows)`);
    };

    let id: string;
    if (givenId) {
      id = givenId;
      console.log('using --id', id, '(list scan skipped)');
    } else {
      await tryList('filter reference=', { reference: ref }, 3);
      const since = parseSince(args.since!);
      await tryList(`updatedAt_from=${since.toISOString()}`, { sort: '-updatedAt', updatedAt_from: since.toISOString() });
      await tryList(`sort=-createdAt`, { sort: '-createdAt' }, 120);

      if (!listRow) {
        console.log('NOT FOUND in any Avantio list scan. Either the reference is wrong, the booking is older than', since.toISOString(), 'and untouched since, or it belongs to another Avantio account.');
        return;
      }
      console.log('found via:', howFound);
      console.log('list row:', j(listRow));
      id = String(listRow.id);
    }
    const det = await client.get(`/bookings/${id}`);
    const raw = det.data?.data ?? det.data;
    const { guests, customer, ...rawNoPii } = raw;
    console.log(`GET /bookings/${id}:`, j(rawNoPii));

    hr('4. Property mapping');
    const accomId = raw.accommodation?.id ? String(raw.accommodation.id) : null;
    console.log('accommodation id on booking:', accomId);
    if (accomId) {
      const prop = await prisma.property.findFirst({ where: { tenantId: t.id, pmsPropertyId: accomId } });
      console.log('local property:', prop ? j({ id: prop.id, name: prop.name, isActive: prop.isActive, pmsLastSyncedAt: prop.pmsLastSyncedAt }) : 'NONE');
      try {
        const a = await client.get(`/accommodations/${accomId}`);
        const ad = a.data?.data ?? a.data;
        console.log('Avantio accommodation:', j({ id: ad.id, name: ad.name, status: ad.status, enabled: ad.enabled, userId: ad.userId }));
      } catch (e: any) {
        console.log(`GET /accommodations/${accomId} failed: ${e.response?.status} ${JSON.stringify(e.response?.data)?.slice(0, 300)}`);
      }
    }

    hr('5. Where it sits relative to the sync');
    const byId = await prisma.booking.findFirst({ where: { tenantId: t.id, pmsBookingId: id } });
    console.log('local Booking with pmsBookingId=' + id + ':', byId ? j({ id: byId.id, bookingRef: byId.bookingRef, status: byId.status, checkInTime: byId.checkInTime }) : 'NONE');
    const fq = await prisma.pmsSyncFailure.findFirst({ where: { tenantId: t.id, pmsBookingId: id } });
    console.log('PmsSyncFailure row for it:', fq ? j(fq) : 'NONE');
    console.log(j({
      avantioStatus: raw.status,
      avantioCreatedAt: raw.createdAt,
      avantioUpdatedAt: raw.updatedAt,
      arrival: raw.stayDates?.arrival,
      departure: raw.stayDates?.departure,
      checkInTime: raw.checkInTime,
      salesChannel: raw.salesChannel?.name,
      tenantWatermark: tenant.pmsLastSyncAt,
      updatedAfterWatermark: tenant.pmsLastSyncAt && raw.updatedAt ? new Date(raw.updatedAt) > tenant.pmsLastSyncAt : null,
    }));

    if (args['window-test']) {
      hr('6. Window-membership test — does GET /bookings ever return this id?');
      const probe = async (label: string, from: Date, maxPages = 60) => {
        let cursor: string | undefined;
        let page = 0, seen = 0;
        while (page < maxPages) {
          page++;
          const params: Record<string, any> = cursor
            ? { pagination_cursor: cursor }
            : { pagination_size: 50, sort: '-updatedAt', updatedAt_from: from.toISOString() };
          let res;
          try { res = await client.get('/bookings', { params }); }
          catch (e: any) { console.log(`  ${label}: page ${page} failed ${e.response?.status}`); return; }
          const items: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
          seen += items.length;
          const hit = items.find((x) => String(x.id) === id);
          if (hit) {
            console.log(`  ${label}: PRESENT (page ${page}, position ${seen - items.length + items.indexOf(hit) + 1}) — list says status=${hit.status} updatedAt=${hit.updatedAt}`);
            return;
          }
          const next = res.data?._links?.next;
          let nextCursor: string | undefined;
          try { nextCursor = next ? new URL(next).searchParams.get('pagination_cursor') || undefined : undefined; } catch { nextCursor = undefined; }
          if (!nextCursor) { console.log(`  ${label}: ABSENT after ${seen} rows / ${page} page(s)`); return; }
          cursor = nextCursor;
          await new Promise((r) => setTimeout(r, 150));
        }
        console.log(`  ${label}: not seen in first ${seen} rows (${maxPages} pages) — inconclusive`);
      };
      const upd = raw.updatedAt ? new Date(raw.updatedAt) : null;
      const cre = raw.createdAt ? new Date(raw.createdAt) : null;
      if (upd) {
        await probe(`updatedAt_from = updatedAt - 5min  (${new Date(upd.getTime() - 5 * 60000).toISOString()})`, new Date(upd.getTime() - 5 * 60000));
        await probe(`updatedAt_from = updatedAt - 6h`, new Date(upd.getTime() - 6 * 3600000));
      }
      if (cre) {
        await probe(`updatedAt_from = createdAt - 5min  (${new Date(cre.getTime() - 5 * 60000).toISOString()})`, new Date(cre.getTime() - 5 * 60000));
      }
      console.log('\nReading: PRESENT in a window we would have asked for => the app was offered it (look in Railway logs for that run).');
      console.log('         ABSENT everywhere => Avantio does not return it for updatedAt_from filters => API-side; a periodic createdAt-based sweep is the fix.');
    }
  } finally {
    await ctx.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
