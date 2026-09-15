// backend/scripts/diag-boundary.ts
//
// READ-ONLY. Tests the "watermark has no overlap" hypothesis for bookings that
// Avantio has and we never created.
//
// Hypothesis: syncTenant stamps pmsLastSyncAt = runStartedAt (wall clock) and
// filters with updatedAt_from (Avantio's clock). A booking whose updatedAt is
// stamped just before a run, but which only becomes queryable just after that
// run's list call (replication lag, or a channel import that backdates
// updatedAt), is never returned to that run — and every later run asks
// updatedAt_from = a timestamp LATER than the booking's updatedAt. It is
// excluded forever, with no error and nothing in pms_sync_failures.
//
// If that is what is happening, the lost bookings' updatedAt must cluster in a
// narrow band around the cron firing times (*/30 -> minute :00 and :30), while
// the population of all bookings is spread evenly across the half hour.
//
//   pnpm diag:boundary -- --tenant prague-stays --since 120d --ids 34015805,33900567,...
//
// Also probes which sort keys GET /bookings actually accepts (the id-sort
// comparison returned 400) and prints the API's own error detail.
//
// Never writes. Never touches pmsLastSyncAt.

import { parseArgs } from 'node:util';
import axios, { AxiosInstance } from 'axios';
import { bootScriptContext, resolveTenant, parseSince, splitList } from './lib/script-context';
import { pmsConfigFor } from '../src/common/pms-config';

const CRON_PERIOD_S = 30 * 60; // */30 — minute :00 and :30, same in UTC (whole-hour offset)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCursor(nextUrl?: string): string | undefined {
  if (!nextUrl) return undefined;
  try { return new URL(nextUrl).searchParams.get('pagination_cursor') || undefined; }
  catch { return undefined; }
}

/** Seconds since the most recent cron boundary (0 .. 1799). */
function offsetFromBoundary(iso: string): number {
  const d = new Date(iso);
  return ((d.getUTCMinutes() * 60 + d.getUTCSeconds()) % CRON_PERIOD_S) + d.getUTCMilliseconds() / 1000;
}
/** Signed distance to the NEAREST boundary: negative = just before, positive = just after. */
function signedDistance(iso: string): number {
  const off = offsetFromBoundary(iso);
  return off > CRON_PERIOD_S / 2 ? off - CRON_PERIOD_S : off;
}

async function probeSorts(client: AxiosInstance, since: Date) {
  const candidates = [
    '-updatedAt', 'updatedAt', 'id', '-id', 'createdAt', '-createdAt',
    'creationDate', '-creationDate', 'reference', '-reference',
    'arrivalDate', '-arrivalDate',
  ];
  console.log('\n──────── which sort keys does GET /bookings accept? ────────');
  for (const sort of candidates) {
    try {
      await client.get('/bookings', { params: { pagination_size: 1, sort, updatedAt_from: since.toISOString() } });
      console.log(`  ${sort.padEnd(16)} OK`);
    } catch (e: any) {
      const d = e.response?.data;
      const detail = d?.details ? JSON.stringify(d.details) : (d?.message ?? e.message);
      console.log(`  ${sort.padEnd(16)} ${e.response?.status ?? '???'}  ${String(detail).slice(0, 180)}`);
    }
    await sleep(120);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const { values: args } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      since: { type: 'string', default: '120d' },
      ids: { type: 'string', multiple: true },
      'skip-sort-probe': { type: 'boolean', default: false },
    },
  });
  if (!args.tenant) { console.error('usage: --tenant <slug> [--since 120d] [--ids a,b,c]'); process.exit(2); }
  const watch = new Set(splitList(args.ids as string[] | undefined));

  const ctx = await bootScriptContext({ quiet: true });
  try {
    const t = await resolveTenant(ctx.prisma, args.tenant);
    const tenant = await ctx.prisma.tenant.findUnique({ where: { id: t.id } });
    const config = pmsConfigFor(tenant!);
    if (!config) throw new Error('tenant has no PMS config');
    const client = axios.create({
      baseURL: config.apiBaseUrl,
      headers: { Accept: 'application/json', 'X-Avantio-Auth': config.apiKey },
      timeout: 30000,
    });
    const since = parseSince(args.since!);

    if (!args['skip-sort-probe']) await probeSorts(client, since);

    // ── enumerate the window exactly as the sync does ──
    console.log(`\n──────── enumerating updatedAt_from=${since.toISOString()} (sort=-updatedAt) ────────`);
    const rows: Array<{ id: string; updatedAt: string; createdAt: string }> = [];
    let cursor: string | undefined; let page = 0; let fullPageNoCursor = false;
    while (true) {
      page++;
      const params: Record<string, any> = cursor
        ? { pagination_cursor: cursor }
        : { pagination_size: 50, sort: '-updatedAt', updatedAt_from: since.toISOString() };
      const res = await client.get('/bookings', { params });
      const items: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
      for (const it of items) if (it.id) rows.push({ id: String(it.id), updatedAt: it.updatedAt, createdAt: it.createdAt });
      cursor = parseCursor(res.data?._links?.next);
      if (!cursor) { if (items.length === 50) fullPageNoCursor = true; break; }
      if (page % 25 === 0) console.log(`  …${rows.length} rows`);
      await sleep(120);
      if (page > 3000) break;
    }
    console.log(`  ${rows.length} rows over ${page} pages${fullPageNoCursor ? '  ⚠ ended on a FULL page with no next cursor' : ''}`);

    const ids = rows.map((r) => r.id);
    const uniq = new Set(ids);
    console.log(`  unique ids: ${uniq.size}   duplicates returned: ${ids.length - uniq.size}`);
    const withUpdated = rows.filter((r) => r.updatedAt);
    console.log(`  rows carrying updatedAt: ${withUpdated.length}`);

    // ── the test ──
    // Bucket every booking by how far its updatedAt sits from a cron boundary.
    const BUCKETS = [10, 20, 30, 60, 120, 300, 900];
    const label = (n: number) => `|dist| <= ${String(n).padStart(3)}s`;
    const popCounts = new Map<number, number>(BUCKETS.map((b) => [b, 0]));
    for (const r of withUpdated) {
      const d = Math.abs(signedDistance(r.updatedAt));
      for (const b of BUCKETS) if (d <= b) popCounts.set(b, popCounts.get(b)! + 1);
    }

    console.log('\n──────── population: distance of updatedAt from a */30 cron boundary ────────');
    console.log(`  (uniform expectation shown for comparison — a boundary band of width 2w out of ${CRON_PERIOD_S}s)`);
    for (const b of BUCKETS) {
      const got = popCounts.get(b)!;
      const expected = withUpdated.length * (2 * b) / CRON_PERIOD_S;
      console.log(`  ${label(b)}  ${String(got).padStart(5)}  (${(100 * got / withUpdated.length).toFixed(2)}%)   uniform would be ${expected.toFixed(1)} (${(200 * b / CRON_PERIOD_S).toFixed(2)}%)`);
    }

    if (watch.size) {
      console.log('\n──────── the bookings we never created ────────');
      const byId = new Map(rows.map((r) => [r.id, r]));
      let within60 = 0, seen = 0;
      for (const id of watch) {
        const r = byId.get(id);
        if (!r) { console.log(`  ${id}  not in this window (older than --since, or not returned)`); continue; }
        seen++;
        const dist = signedDistance(r.updatedAt);
        if (Math.abs(dist) <= 60) within60++;
        const when = dist < 0 ? `${Math.abs(dist).toFixed(1)}s BEFORE` : `${dist.toFixed(1)}s after`;
        console.log(`  ${id}  updatedAt=${r.updatedAt}  created=${r.createdAt}  -> ${when} a cron boundary`);
      }
      if (seen) {
        const expectedPct = 200 * 60 / CRON_PERIOD_S;
        console.log(`\n  ${within60}/${seen} of the missing bookings are within 60s of a cron boundary.`);
        console.log(`  If losses were unrelated to the sync cadence, roughly ${expectedPct.toFixed(1)}% would be — i.e. ${(seen * expectedPct / 100).toFixed(2)} of ${seen}.`);
        console.log('\n  Reading: a strong clustering at the boundary means the loss is the run-boundary');
        console.log('  race — the watermark advanced past records that were not yet queryable. The fix is');
        console.log('  an overlap: since = pmsLastSyncAt - OVERLAP, not since = pmsLastSyncAt.');
        console.log('  No clustering means the cadence is innocent and the cause is elsewhere.');
      }
    }
  } finally {
    await ctx.close();
  }
}
main().catch((e) => {
  if (e?.response) {
    console.error(`HTTP ${e.response.status}`, JSON.stringify(e.response.data, null, 2));
  } else console.error(e);
  process.exit(1);
});
