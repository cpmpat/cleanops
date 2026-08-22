#!/usr/bin/env ts-node
/**
 * backfill-checkin-times.ts
 *
 * Repairs bookings whose check-in was stored as midnight because Avantio sent
 * "0:00" and the adapter took it literally.
 *
 * THE BUG THIS REPAIRS
 *   `mapBooking` used `raw.checkInTime || '15:00'`. Airbnb bookings arrive with
 *   `checkInTime: "0:00 "` — a non-empty string, so the default never fired and
 *   midnight was stored as though the guest had asked for it. The turnover
 *   inherits its deadline from the next guest's arrival, so every one of these
 *   cleanings has been due at the start of its day and has looked overdue from
 *   the first second.
 *
 * WHY THIS NEEDS NO API CALLS
 *   `Booking.pmsRawData` holds the verbatim Avantio payload, so what Avantio
 *   said is already in the database. That is also what makes the match rule
 *   safe: a row is only rewritten when the stored time is local midnight AND
 *   the raw payload says the time was unknown. If a manager had set a real
 *   time, one of those two is false — either the sync has run since and the raw
 *   carries their time, or it has not and the stored time is theirs. Either
 *   way the row is skipped.
 *
 * WHAT IT WRITES
 *   checkInTime  → 15:00 local on the same day
 *   checkInSource → FALLBACK (so the app can ask a manager to confirm it)
 *   the linked legacy Cleaning row's checkInTime / timeSlot, as the sync does
 *   and re-threads the affected turnovers so dueBy follows the new arrival.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless you pass --apply.
 *
 * Usage:
 *   npm run backfill:checkin-times -- --tenant prague-stays
 *   npm run backfill:checkin-times -- --tenant prague-stays --apply
 *
 * Options:
 *   --tenant <id|slug>   required
 *   --apply              write (default: report only)
 *   --include-past       also touch bookings whose arrival is in the past
 *   --limit <n>          process at most n bookings
 *   --json <path>        write the full machine-readable report
 *   --limit-output <n>   max rows printed per group (default 20)
 *
 * Exit codes:
 *   0  success (a dry run that found work still exits 0 — it is a report)
 *   1  one or more bookings failed to update
 *   2  bad usage
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { bootScriptContext, resolveTenant, fmtDuration } from './lib/script-context';
import { timeInAppZone, todayInAppZone, atTimeInAppZone } from '../src/common/time';

/** The house default when nobody said when the guest arrives. */
const FALLBACK_CHECKIN = '15:00';

/** Same rule the adapter uses, kept in sync by being this short. */
function isUnknownTime(raw: unknown): boolean {
  const cleaned = String(raw ?? '').trim();
  return cleaned === '' || /^0{1,2}:0{1,2}(:0{1,2})?$/.test(cleaned);
}

type Row = {
  id: string;
  bookingRef: string;
  property: string;
  channel: string;
  from: string;
  to?: string;
  reason?: string;
};

async function main() {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'include-past': { type: 'boolean', default: false },
      limit: { type: 'string' },
      json: { type: 'string' },
      'limit-output': { type: 'string' },
    },
  });

  if (!values.tenant) {
    console.error('Missing --tenant <id|slug>');
    process.exit(2);
  }

  const printLimit = Number(values['limit-output'] ?? 20);
  const started = Date.now();
  const ctx = await bootScriptContext({ quiet: true });

  try {
    const tenant = await resolveTenant(ctx.prisma, values.tenant);
    console.log(`\nTenant: ${tenant.name} (${tenant.slug})`);
    console.log(values.apply ? 'Mode:   APPLY — writing changes' : 'Mode:   DRY RUN — nothing will be written');

    const candidates = await ctx.prisma.booking.findMany({
      where: {
        tenantId: tenant.id,
        status: 'CONFIRMED',
        ...(values['include-past'] ? {} : { checkInTime: { gte: new Date() } }),
      },
      include: {
        property: { select: { name: true } },
        cleaning: { select: { id: true } },
      },
      orderBy: { checkInTime: 'asc' },
      ...(values.limit ? { take: Number(values.limit) } : {}),
    });

    const toFix: Row[] = [];
    const skippedManager: Row[] = [];
    const skippedRawHasTime: Row[] = [];

    for (const b of candidates) {
      const isMidnight = timeInAppZone(b.checkInTime) === '00:00';
      if (!isMidnight) continue;

      const base: Row = {
        id: b.id,
        bookingRef: b.bookingRef,
        property: b.property?.name ?? b.accommodationName,
        channel: b.channel,
        from: `${todayInAppZone(b.checkInTime)} 00:00`,
      };

      if (b.checkInSource === 'MANAGER') {
        skippedManager.push({ ...base, reason: 'time set by a manager' });
        continue;
      }

      const rawTime = (b.pmsRawData as any)?.checkInTime;
      if (!isUnknownTime(rawTime)) {
        // Midnight locally but Avantio has a real time: something happened that
        // this script does not model. Report it, do not guess.
        skippedRawHasTime.push({
          ...base,
          reason: `PMS says "${String(rawTime).trim()}" — needs a look`,
        });
        continue;
      }

      toFix.push({ ...base, to: `${todayInAppZone(b.checkInTime)} ${FALLBACK_CHECKIN}` });
    }

    // ─── Report ───────────────────────────────────────────────────────────────
    const byChannel = toFix.reduce<Record<string, number>>((acc, r) => {
      acc[r.channel] = (acc[r.channel] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`\nBookings scanned:            ${candidates.length}`);
    console.log(`Midnight arrivals to fix:    ${toFix.length}`);
    if (Object.keys(byChannel).length) {
      console.log(`  by channel: ${Object.entries(byChannel).map(([c, n]) => `${c}: ${n}`).join(' · ')}`);
    }
    console.log(`Skipped — set by a manager:  ${skippedManager.length}`);
    console.log(`Skipped — PMS has a time:    ${skippedRawHasTime.length}`);

    const show = (title: string, rows: Row[]) => {
      if (!rows.length) return;
      console.log(`\n─ ${title} ─`);
      rows.slice(0, printLimit).forEach((r) => {
        const tail = r.to ? `${r.from} → ${r.to}` : `${r.from}  (${r.reason})`;
        console.log(`  ${r.bookingRef.padEnd(18)} ${r.property.slice(0, 28).padEnd(30)} ${tail}`);
      });
      if (rows.length > printLimit) console.log(`  … and ${rows.length - printLimit} more`);
    };

    show('to fix', toFix);
    show('skipped: manager already set the time', skippedManager);
    show('skipped: PMS reports a real time', skippedRawHasTime);

    // ─── Apply ────────────────────────────────────────────────────────────────
    let failed = 0;
    let turnoversRethreaded = 0;

    if (values.apply && toFix.length) {
      console.log('\nApplying…');
      for (const row of toFix) {
        const booking = candidates.find((b) => b.id === row.id)!;
        const localDay = todayInAppZone(booking.checkInTime);
        const newCheckIn = atTimeInAppZone(localDay, FALLBACK_CHECKIN);
        const oldCheckIn = booking.checkInTime;

        try {
          await ctx.prisma.$transaction(async (tx) => {
            await tx.booking.update({
              where: { id: booking.id },
              data: { checkInTime: newCheckIn, checkInSource: 'FALLBACK' },
            });

            if (booking.cleaning) {
              await tx.cleaning.update({
                where: { id: booking.cleaning.id },
                data: { checkInTime: newCheckIn, timeSlot: newCheckIn },
              });
            }

            // Same path the sync uses — the turnover chain has one owner.
            await ctx.turnoverSync.onBookingModified(booking.id, oldCheckIn, tx as any);
            turnoversRethreaded++;
          });
        } catch (err) {
          failed++;
          console.error(`  ✗ ${row.bookingRef}: ${(err as Error).message}`);
        }
      }
      console.log(`Updated ${toFix.length - failed} bookings, re-threaded ${turnoversRethreaded} turnover chains.`);
    } else if (toFix.length) {
      console.log('\nDry run — nothing written. Re-run with --apply to write.');
    }

    if (values.json) {
      writeFileSync(
        values.json,
        JSON.stringify({ tenant, toFix, skippedManager, skippedRawHasTime }, null, 2),
      );
      console.log(`\nReport written to ${values.json}`);
    }

    console.log(`\nDone in ${fmtDuration(Date.now() - started)}.\n`);
    process.exit(failed ? 1 : 0);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
