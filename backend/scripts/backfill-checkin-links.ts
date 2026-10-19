#!/usr/bin/env ts-node
/**
 * backfill-checkin-links.ts
 *
 * Fills `Booking.checkInLinkUrl` from the Avantio payload already stored in
 * `pmsRawData`. No API calls, no notifications, no turnover writes.
 *
 * Bookings whose stored payload predates the link cannot be filled locally;
 * they are counted as "no link in payload". For future arrivals, re-fetch with
 *   npm run backfill:bookings -- --tenant <slug> --updated-since 3650d --apply
 *
 * The link is a bearer token to guest registration, so this script never
 * prints it: reports show booking refs and counts only.
 *
 * Usage:
 *   npm run backfill:checkin-links -- --tenant prague-stays          # dry run
 *   npm run backfill:checkin-links -- --tenant prague-stays --apply
 *
 * Options: --tenant <id|slug> (required), --apply, --since <7d|ISO>, --limit <n>
 * Exit codes: 0 ok, 1 some updates failed, 2 bad usage
 */

import { parseArgs } from 'node:util';
import { bootScriptContext, resolveTenant, parseSince } from './lib/script-context';
import { extractCheckInLink } from '../src/integrations/avantio/avantio.adapter';

function parse() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  try {
    return parseArgs({
      args: argv,
      options: {
        tenant: { type: 'string' },
        apply: { type: 'boolean', default: false },
        since: { type: 'string' },
        limit: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (err: any) {
    console.error(`Bad usage: ${err.message}`);
    process.exit(2);
  }
}

async function run() {
  const opts = parse() as Record<string, any>;
  if (!opts.tenant) {
    console.error('Bad usage: --tenant is required.');
    process.exit(2);
  }
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
  if (opts.limit && (!Number.isFinite(limit!) || limit! < 1)) {
    console.error(`Bad usage: --limit must be a positive integer, got "${opts.limit}".`);
    process.exit(2);
  }
  const since = opts.since ? parseSince(opts.since) : undefined;

  const ctx = await bootScriptContext({ quiet: true });
  let failed = 0;
  try {
    const tenant = await resolveTenant(ctx.prisma, opts.tenant);
    console.log('');
    console.log(`Tenant     ${tenant.name} (${tenant.slug})`);
    console.log(`Mode       ${opts.apply ? 'APPLY — writing' : 'DRY RUN — no writes'}`);
    if (since) console.log(`Since      checkInTime >= ${since.toISOString()}`);
    console.log('');

    const bookings = await ctx.prisma.booking.findMany({
      where: {
        tenantId: tenant.id,
        pmsRawData: { not: null as any },
        ...(since ? { checkInTime: { gte: since } } : {}),
      },
      select: {
        id: true,
        bookingRef: true,
        checkInTime: true,
        checkInLinkUrl: true,
        pmsRawData: true,
      },
      orderBy: { checkInTime: 'asc' },
      ...(limit ? { take: limit } : {}),
    });

    let inSync = 0;
    let noLink = 0;
    const toWrite: Array<{ id: string; ref: string; url: string; provider: string; kind: 'add' | 'change' }> = [];

    for (const b of bookings) {
      const raw = b.pmsRawData as any;
      const partners = raw?.externalPartners ?? raw?.data?.externalPartners;
      const link = extractCheckInLink(partners);
      if (!link) {
        noLink++;
        continue;
      }
      if (b.checkInLinkUrl === link.url) {
        inSync++;
        continue;
      }
      toWrite.push({
        id: b.id,
        ref: b.bookingRef,
        url: link.url,
        provider: link.provider,
        kind: b.checkInLinkUrl ? 'change' : 'add',
      });
    }

    console.log(`Scanned          ${bookings.length}`);
    console.log(`Already in sync  ${inSync}`);
    console.log(`No link in payload  ${noLink}`);
    console.log(`To add           ${toWrite.filter((r) => r.kind === 'add').length}`);
    console.log(`To change        ${toWrite.filter((r) => r.kind === 'change').length}`);
    console.log('');

    if (opts.apply && toWrite.length) {
      const now = new Date();
      for (const r of toWrite) {
        try {
          await ctx.prisma.booking.update({
            where: { id: r.id },
            data: { checkInLinkUrl: r.url, checkInLinkProvider: r.provider, checkInLinkSyncedAt: now },
          });
        } catch (err: any) {
          failed++;
          console.error(`  FAILED ${r.ref}: ${err.message}`);
        }
      }
      console.log(`Updated ${toWrite.length - failed}, failed ${failed}.`);
    } else if (toWrite.length) {
      console.log('Dry run — pass --apply to write.');
    }
  } finally {
    await ctx.close?.();
  }
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
