#!/usr/bin/env ts-node
/**
 * backfill-occupancy.ts
 *
 * Repairs `numAdults` / `numChildren` on existing bookings after the Avantio
 * children-count fix.
 *
 * THE BUG THIS REPAIRS
 *   `AvantioAdapter.mapBooking` used to read `occupancy.children.length`.
 *   `children` is an array of age GROUPS, each with an `amount` — so
 *   `{ adults: 2, children: [{ amount: 2, age: 12 }] }` is a party of 4 but was
 *   stored as 2 adults + 1 child and rendered as "3". Every booking whose party
 *   had two or more children in one age bracket is undercounted.
 *
 * WHY THIS NEEDS NO API CALLS
 *   `Booking.pmsRawData` already holds the verbatim Avantio payload, so the
 *   correct numbers are in the database. This script re-derives them locally
 *   through the SAME `parseOccupancy` the adapter now uses — there is one
 *   occupancy code path, not two. Re-fetching ~700 bookings from Avantio would
 *   produce identical values and cost 10+ minutes of API load.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless you pass --apply.
 * No notifications are emitted: this corrects a display column, it does not
 * create, move or reassign work.
 *
 * Usage:
 *   # what is wrong, and by how much?
 *   npm run backfill:occupancy -- --tenant prague-stays
 *
 *   # fix it
 *   npm run backfill:occupancy -- --tenant prague-stays --apply
 *
 * Options:
 *   --tenant <id|slug>   required
 *   --apply              write (default: report only)
 *   --since <7d|ISO>     only bookings with checkInTime at/after this
 *   --limit <n>          process at most n bookings
 *   --json <path>        write the full machine-readable report
 *   --limit-output <n>   max rows printed per group (default 20)
 *
 * Exit codes:
 *   0  success (dry run with drift still exits 0 — it is a report)
 *   1  one or more bookings failed to update
 *   2  bad usage
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { bootScriptContext, resolveTenant, parseSince, fmtDuration } from './lib/script-context';
import {
  parseOccupancy,
  type AvantioBookingRaw,
} from '../src/integrations/avantio/avantio.adapter';

type Row = {
  bookingId: string;
  bookingRef: string;
  pmsBookingId: string | null;
  checkInTime: string;
  accommodationName: string;
  storedAdults: number;
  storedChildren: number;
  correctAdults: number;
  correctChildren: number;
  cleaningId: string | null;
  cleaningDrifted: boolean;
};

function main() {
  // npm strips the `--` separator before handing argv to the script; pnpm
  // forwards it verbatim. parseArgs treats a literal `--` as end-of-options and
  // then rejects everything after it as a positional, so `pnpm run x -- --tenant y`
  // would die with "does not take positional arguments". Drop a leading `--` so
  // the same command line works under either runner.
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();

  let opts;
  try {
    ({ values: opts } = parseArgs({
      args: argv,
      options: {
        tenant: { type: 'string' },
        apply: { type: 'boolean', default: false },
        since: { type: 'string' },
        limit: { type: 'string' },
        json: { type: 'string' },
        'limit-output': { type: 'string' },
      },
      strict: true,
    }));
  } catch (err: any) {
    console.error(`Bad usage: ${err.message}`);
    process.exit(2);
  }
  return opts;
}

async function run() {
  const opts = main() as Record<string, any>;

  if (!opts.tenant) {
    console.error('Bad usage: --tenant is required.');
    process.exit(2);
  }
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
  if (opts.limit && (!Number.isFinite(limit!) || limit! < 1)) {
    console.error(`Bad usage: --limit must be a positive integer, got "${opts.limit}".`);
    process.exit(2);
  }
  const limitOutput = opts['limit-output'] ? parseInt(opts['limit-output'], 10) : 20;
  const since = opts.since ? parseSince(opts.since) : undefined;

  const started = Date.now();
  const ctx = await bootScriptContext({ quiet: true });

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
        ...(since ? { checkInTime: { gte: since } } : {}),
      },
      select: {
        id: true,
        bookingRef: true,
        pmsBookingId: true,
        checkInTime: true,
        accommodationName: true,
        numAdults: true,
        numChildren: true,
        pmsRawData: true,
        cleaning: { select: { id: true, numAdults: true, numChildren: true } },
      },
      orderBy: { checkInTime: 'asc' },
      ...(limit ? { take: limit } : {}),
    });

    const drifted: Row[] = [];
    const cleaningOnly: Row[] = [];
    let clean = 0;
    let noRaw = 0;

    for (const b of bookings) {
      const raw = b.pmsRawData as unknown as { data?: AvantioBookingRaw } & AvantioBookingRaw | null;
      // Tolerate both the unwrapped booking and a `{ data: ... }` envelope.
      const occupancy = (raw as any)?.occupancy ?? (raw as any)?.data?.occupancy;

      if (!raw || occupancy === undefined) {
        noRaw++;
        continue;
      }

      const { numAdults, numChildren } = parseOccupancy(occupancy);
      const bookingDrifted = b.numAdults !== numAdults || b.numChildren !== numChildren;
      const cleaningDrifted =
        !!b.cleaning &&
        (b.cleaning.numAdults !== numAdults || b.cleaning.numChildren !== numChildren);

      const row: Row = {
        bookingId: b.id,
        bookingRef: b.bookingRef,
        pmsBookingId: b.pmsBookingId,
        checkInTime: b.checkInTime.toISOString(),
        accommodationName: b.accommodationName,
        storedAdults: b.numAdults,
        storedChildren: b.numChildren,
        correctAdults: numAdults,
        correctChildren: numChildren,
        cleaningId: b.cleaning?.id ?? null,
        cleaningDrifted,
      };

      if (bookingDrifted) drifted.push(row);
      else if (cleaningDrifted) cleaningOnly.push(row);
      else clean++;
    }

    // ── Report ──
    const show = (label: string, rows: Row[]) => {
      if (!rows.length) return;
      console.log(`${label} (${rows.length})`);
      for (const r of rows.slice(0, limitOutput)) {
        const was = `${r.storedAdults}+${r.storedChildren}`;
        const now = `${r.correctAdults}+${r.correctChildren}`;
        const wasTotal = r.storedAdults + r.storedChildren;
        const nowTotal = r.correctAdults + r.correctChildren;
        const delta = nowTotal - wasTotal;
        console.log(
          `  ${r.bookingRef.padEnd(20)} ${r.checkInTime.slice(0, 10)}  ` +
          `${was} (${wasTotal}) -> ${now} (${nowTotal})  ` +
          `${delta > 0 ? `+${delta}` : delta}  ${r.accommodationName}`,
        );
      }
      if (rows.length > limitOutput) console.log(`  … ${rows.length - limitOutput} more`);
      console.log('');
    };

    console.log(`Scanned    ${bookings.length} bookings`);
    console.log(`Correct    ${clean}`);
    if (noRaw) {
      console.log(
        `No raw     ${noRaw} — pmsRawData missing or has no occupancy; cannot be ` +
        `repaired locally. Re-sync with: npm run backfill:bookings -- --tenant ${tenant.slug} --updated-since 3650d`,
      );
    }
    console.log('');

    show('DRIFT — booking counts wrong', drifted);
    show('DRIFT — booking correct, denormalized cleaning stale', cleaningOnly);

    const toFix = [...drifted, ...cleaningOnly];

    // Turnovers carry NO occupancy columns of their own — TurnoverCard reads
    // through the `toBooking` relation. So repairing the Booking row is the
    // whole fix; there is nothing to write on `turnovers` and no reconcile to
    // run. This count is reported purely so the blast radius is visible.
    const driftedBookingIds = drifted.map((r) => r.bookingId);
    let affectedTurnovers = 0;
    if (driftedBookingIds.length) {
      affectedTurnovers = await ctx.prisma.turnover.count({
        where: {
          tenantId: tenant.id,
          supersededById: null,
          OR: [
            { toBookingId: { in: driftedBookingIds } },
            { fromBookingId: { in: driftedBookingIds } },
          ],
        },
      });
    }
    const undercounted = drifted.filter(
      (r) => r.correctAdults + r.correctChildren > r.storedAdults + r.storedChildren,
    );
    const totalMissingGuests = undercounted.reduce(
      (s, r) => s + (r.correctAdults + r.correctChildren) - (r.storedAdults + r.storedChildren),
      0,
    );
    if (undercounted.length) {
      console.log(
        `${totalMissingGuests} guest(s) were missing from ${undercounted.length} booking(s).`,
      );
    }
    if (affectedTurnovers) {
      console.log(
        `${affectedTurnovers} active turnover(s) reference a corrected booking and will ` +
        `show the new count — turnovers store no occupancy of their own, so they need no write.`,
      );
    }
    if (undercounted.length || affectedTurnovers) console.log('');

    if (opts.json) {
      writeFileSync(
        opts.json,
        JSON.stringify(
          { tenant, generatedAt: new Date().toISOString(), applied: !!opts.apply, scanned: bookings.length, clean, noRaw, affectedTurnovers, drifted, cleaningOnly },
          null,
          2,
        ),
      );
      console.log(`Report written to ${opts.json}`);
    }

    if (!toFix.length) {
      console.log('Nothing to fix.');
      return 0;
    }

    if (!opts.apply) {
      console.log(`DRY RUN — ${toFix.length} booking(s) would be updated. Re-run with --apply to write.`);
      return 0;
    }

    // ── Apply ──
    let updated = 0;
    let failed = 0;
    for (const r of toFix) {
      try {
        await ctx.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: r.bookingId },
            data: { numAdults: r.correctAdults, numChildren: r.correctChildren },
          });
          // Cleaning denormalizes these two columns; keep the copies in step or
          // the cleaner card and the manager card disagree.
          await tx.cleaning.updateMany({
            where: { bookingId: r.bookingId },
            data: { numAdults: r.correctAdults, numChildren: r.correctChildren },
          });
        });
        updated++;
      } catch (err: any) {
        failed++;
        console.error(`  FAILED ${r.bookingRef}: ${err.message}`);
      }
    }

    console.log('');
    console.log(`Updated    ${updated}`);
    if (failed) console.log(`Failed     ${failed}`);
    console.log(`Elapsed    ${fmtDuration(Date.now() - started)}`);
    console.log('');
    console.log(
      'Turnover rows read these columns through the booking relation, so no ' +
      'turnover reconcile is needed. Open browser sessions show the old number ' +
      'until their next refetch.',
    );

    return failed ? 1 : 0;
  } finally {
    await ctx.close();
  }
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
