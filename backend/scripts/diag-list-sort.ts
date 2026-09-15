// backend/scripts/diag-list-sort.ts
//
// READ-ONLY. Proves (or refutes) the hypothesis that the booking sync loses
// IDs at the list level because collectBookingIds pages GET /bookings with
// sort=-updatedAt — an actively-changing, tie-heavy key — while a stable sort
// (id) returns the complete set.
//
// It enumerates the SAME window (updatedAt_from = now - <since>) twice, exactly
// the way the production sync pages, once per sort key, and diffs the ID sets.
//
//   pnpm diag:list-sort -- --tenant prague-stays [--since 120d] [--ids 34015805,33900567]
//
// Reading:
//   ids in id-sort but MISSING from updatedAt-sort  => the production path drops
//     them => this is the loss mechanism. Any --ids listed here are proven lost
//     by the sort, not by status/mapping/queue.
//   both sets equal => the sort is not the cause; move to Railway logs / cadence.
//
// Never writes. Never touches pmsLastSyncAt.

import { parseArgs } from 'node:util';
import axios, { AxiosInstance } from 'axios';
import { bootScriptContext, resolveTenant, parseSince, splitList } from './lib/script-context';
import { pmsConfigFor } from '../src/common/pms-config';

function parseCursor(nextUrl?: string): string | undefined {
  if (!nextUrl) return undefined;
  try { return new URL(nextUrl).searchParams.get('pagination_cursor') || undefined; }
  catch { return undefined; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replicate collectBookingIds for an arbitrary sort. Returns the ordered id
 * list AND the ordered updatedAt list, plus whether Avantio ever returned a
 * full page with no next cursor (early-truncation signal).
 */
async function enumerate(client: AxiosInstance, since: Date, sort: string) {
  const ids: string[] = [];
  const updated: string[] = [];
  let cursor: string | undefined;
  let page = 0;
  let fullPageNoCursor = false;
  const PAGE_SIZE = 50;
  while (true) {
    page++;
    const params: Record<string, any> = cursor
      ? { pagination_cursor: cursor }
      : { pagination_size: PAGE_SIZE, sort, updatedAt_from: since.toISOString() };
    const res = await client.get('/bookings', { params });
    const items: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
    for (const it of items) { if (it.id) { ids.push(String(it.id)); updated.push(it.updatedAt); } }
    cursor = parseCursor(res.data?._links?.next);
    if (!cursor) { if (items.length === PAGE_SIZE) fullPageNoCursor = true; break; }
    await sleep(150);
    if (page > 2000) break;
  }
  return { ids, updated, pages: page, fullPageNoCursor };
}

function dupes(ids: string[]) {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const id of ids) { if (seen.has(id)) dup.add(id); else seen.add(id); }
  return { unique: seen.size, duplicated: [...dup] };
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
    },
  });
  if (!args.tenant) { console.error('usage: --tenant <slug|id> [--since 120d] [--ids a,b]'); process.exit(2); }
  const watch = new Set(splitList(args.ids as string[] | undefined));

  const ctx = await bootScriptContext({ quiet: true });
  try {
    const t = await resolveTenant(ctx.prisma, args.tenant);
    const tenant = await ctx.prisma.tenant.findUnique({ where: { id: t.id } });
    const config = pmsConfigFor(tenant!);
    if (!config) throw new Error('tenant has no PMS config (need CREDENTIALS_ENCRYPTION_KEY in .env.production)');
    const client = axios.create({
      baseURL: config.apiBaseUrl,
      headers: { Accept: 'application/json', 'X-Avantio-Auth': config.apiKey },
      timeout: 30000,
    });
    const since = parseSince(args.since!);

    console.log(`Window: updatedAt_from = ${since.toISOString()}  (--since ${args.since})`);
    console.log('Enumerating with sort=-updatedAt (the production path)…');
    const prod = await enumerate(client, since, '-updatedAt');
    console.log(`  ${prod.ids.length} rows over ${prod.pages} pages${prod.fullPageNoCursor ? '  ⚠ ended on a FULL page with no next cursor (early truncation!)' : ''}`);
    console.log('Enumerating with sort=id (stable key)…');
    const stable = await enumerate(client, since, 'id');
    console.log(`  ${stable.ids.length} rows over ${stable.pages} pages${stable.fullPageNoCursor ? '  ⚠ ended on a FULL page with no next cursor' : ''}`);

    const dProd = dupes(prod.ids), dStable = dupes(stable.ids);
    const setProd = new Set(prod.ids), setStable = new Set(stable.ids);
    const inStableNotProd = [...setStable].filter((x) => !setProd.has(x));
    const inProdNotStable = [...setProd].filter((x) => !setStable.has(x));

    console.log('\n──────── result ────────');
    console.log(`unique ids  -updatedAt: ${dProd.unique}   id: ${dStable.unique}`);
    console.log(`duplicates  -updatedAt: ${dProd.duplicated.length}   id: ${dStable.duplicated.length}`);
    console.log(`MISSING from the production (-updatedAt) path but present under stable sort: ${inStableNotProd.length}`);
    if (inStableNotProd.length) console.log('  ' + inStableNotProd.slice(0, 60).join(', ') + (inStableNotProd.length > 60 ? ` … (+${inStableNotProd.length - 60})` : ''));
    console.log(`present only under -updatedAt (stable sort dropped these): ${inProdNotStable.length}`);
    if (inProdNotStable.length) console.log('  ' + inProdNotStable.slice(0, 60).join(', '));

    if (watch.size) {
      console.log('\n──────── watched ids ────────');
      for (const id of watch) {
        console.log(`  ${id}: ${setProd.has(id) ? 'in -updatedAt' : 'MISSING from -updatedAt'} | ${setStable.has(id) ? 'in id-sort' : 'missing from id-sort'}`);
      }
    }

    console.log('\nReading: a non-empty "MISSING from the production path" set is the loss mechanism reproduced on your data.');
    console.log('         A watched id that is "MISSING from -updatedAt" but "in id-sort" is proven lost by the sort key alone.');
  } finally {
    await ctx.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
