#!/usr/bin/env ts-node
/**
 * backfill-bookings.ts
 *
 * Fills gaps: bookings Avantio has that our database is missing (or holds a
 * stale copy of), usually because a sync run failed mid-window or the process
 * restarted. It reuses BookingSyncService.processBooking, so timezone handling,
 * Avantio status mapping and the turnover dual-write behave exactly as they do
 * in the 30-minute cron.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless you pass --apply.
 * NOTIFICATIONS ARE OFF by default — pass --notify only if the cleaners really
 * should be pinged about these bookings.
 *
 * This script NEVER writes tenant.pmsLastSyncAt. The cron uses that column as
 * its `since`; advancing it here would make the cron skip a window it never
 * actually covered.
 *
 * Usage:
 *   # what has Avantio changed in the last 30 days that we never recorded?
 *   npm run backfill:bookings -- --tenant prague-stays --updated-since 30d --find-missing
 *
 *   # same, but also re-sync bookings we do have (catches stale times)
 *   npm run backfill:bookings -- --tenant prague-stays --updated-since 7d
 *
 *   # a specific list, e.g. the failed IDs from a previous run
 *   npm run backfill:bookings -- --tenant prague-stays --ids-file failed-ids.txt --apply
 *
 * Options:
 *   --tenant <id|slug>       required
 *   --updated-since <7d|ISO> ask Avantio for everything it touched since then
 *   --ids <a,b,c>            explicit Avantio booking IDs
 *   --ids-file <path>        one Avantio booking ID per line (# comments ok)
 *   --find-missing           keep only IDs with no Booking row locally
 *   --apply                  write (default: report only)
 *   --notify                 allow notifications (default: suppressed)
 *   --concurrency <n>        parallel detail fetches (default 5)
 *   --limit <n>              process at most n IDs (after filtering)
 *   --checkpoint <path>      append processed IDs here; skipped on re-run
 *   --no-reconcile-after     skip the post-backfill turnover reconcile
 *   --json <path>            write the full machine-readable report
 *   --limit-output <n>       max lines printed per outcome group (default 20)
 *
 * Exit codes:
 *   0  success
 *   1  one or more bookings failed, or the post-run reconcile did not converge
 *   2  bad usage
 */

import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  bootScriptContext,
  resolveTenant,
  parseSince,
  splitList,
  fmtDuration,
} from './lib/script-context';
import type { BookingSyncOutcome } from '../src/integrations/booking-sync.service';

function readIdsFile(path: string): string[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((l) => l.split('#')[0].trim())
    .filter((l) => l.length > 0);
}

function loadCheckpoint(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(readIdsFile(path));
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        tenant: { type: 'string' },
        'updated-since': { type: 'string' },
        ids: { type: 'string', multiple: true },
        'ids-file': { type: 'string' },
        'find-missing': { type: 'boolean', default: false },
        apply: { type: 'boolean', default: false },
        notify: { type: 'boolean', default: false },
        concurrency: { type: 'string', default: '5' },
        limit: { type: 'string' },
        checkpoint: { type: 'string' },
        'no-reconcile-after': { type: 'boolean', default: false },
        json: { type: 'string' },
        'limit-output': { type: 'string', default: '20' },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    });
  } catch (err) {
    console.error(`Bad usage: ${(err as Error).message}`);
    return 2;
  }

  const args = parsed.values;
  const idsInline = splitList(args.ids);

  if (args.help || !args.tenant || (!args['updated-since'] && !idsInline.length && !args['ids-file'])) {
    console.error(
      'Usage: backfill-bookings --tenant <id|slug> ' +
      '(--updated-since 30d | --ids a,b | --ids-file path) ' +
      '[--find-missing] [--apply] [--notify] [--concurrency 5] [--limit n]',
    );
    return args.help ? 0 : 2;
  }

  const concurrency = Math.max(1, Math.min(parseInt(args.concurrency as string, 10) || 5, 10));
  const printLimit = Math.max(1, parseInt(args['limit-output'] as string, 10) || 20);
  const startedAt = Date.now();

  const ctx = await bootScriptContext({ quiet: true });

  try {
    const tenant = await resolveTenant(ctx.prisma, args.tenant as string);
    const { adapter, config } = await ctx.bookingSync.getTenantSyncContext(tenant.id);

    console.log('─'.repeat(72));
    console.log(`Avantio booking backfill — ${tenant.name} (${tenant.slug})`);
    console.log(`Mode:     ${args.apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
    console.log(`Notify:   ${args.notify ? 'ENABLED — cleaners will be notified' : 'suppressed'}`);
    console.log('─'.repeat(72));

    // ── Step 1: assemble the candidate ID list ──
    let ids: string[] = [];
    const notes: string[] = [];

    if (args['updated-since']) {
      const since = parseSince(args['updated-since'] as string);
      console.log(`\nAsking Avantio for booking IDs updated since ${since.toISOString()}...`);
      const listed = await adapter.listBookingIdsUpdatedSince(since, config);
      console.log(`  Avantio returned ${listed.length} booking ID(s)`);
      ids.push(...listed);
    }
    if (args['ids-file']) {
      const fromFile = readIdsFile(args['ids-file'] as string);
      console.log(`  ${fromFile.length} ID(s) from ${args['ids-file']}`);
      ids.push(...fromFile);
    }
    if (idsInline.length) {
      console.log(`  ${idsInline.length} ID(s) from --ids`);
      ids.push(...idsInline);
    }

    ids = [...new Set(ids)];

    if (args['find-missing']) {
      const before = ids.length;
      ids = await ctx.bookingSync.findMissingPmsBookingIds(tenant.id, ids);
      console.log(
        `\n--find-missing: ${ids.length} of ${before} ID(s) have no Booking row locally ` +
        `(${before - ids.length} already present, skipped)`,
      );
      notes.push(
        `--find-missing skipped ${before - ids.length} ID(s) that already exist locally. ` +
        `Those rows were NOT checked for stale times — drop --find-missing to re-sync them too.`,
      );
    }

    const checkpointPath = args.checkpoint as string | undefined;
    if (checkpointPath) {
      const done = loadCheckpoint(checkpointPath);
      if (done.size > 0) {
        const before = ids.length;
        ids = ids.filter((id) => !done.has(id));
        console.log(`Checkpoint ${checkpointPath}: skipping ${before - ids.length} already-processed ID(s)`);
      }
    }

    if (args.limit) {
      const limit = parseInt(args.limit as string, 10);
      if (ids.length > limit) {
        notes.push(`--limit ${limit} dropped ${ids.length - limit} ID(s) from this run.`);
        ids = ids.slice(0, limit);
      }
    }

    if (ids.length === 0) {
      console.log('\nNothing to do — no booking IDs left after filtering.');
      return 0;
    }

    console.log(`\nProcessing ${ids.length} booking ID(s), fetch concurrency ${concurrency}.`);

    // ── Step 2: preview or apply ──
    const onFetchProgress = (done: number, total: number) => {
      if (done % 50 === 0 || done === total) console.log(`  fetched ${done}/${total}`);
    };

    let outcomes: BookingSyncOutcome[];

    if (!args.apply) {
      outcomes = await ctx.bookingSync.previewBookingsByPmsIds(tenant.id, ids, {
        concurrency,
        onProgress: onFetchProgress,
      });
    } else {
      const run = () =>
        ctx.bookingSync.syncBookingsByPmsIds(tenant.id, ids, {
          concurrency,
          onFetchProgress,
          onProcessed: (outcome, index, total) => {
            if (checkpointPath && outcome.result !== 'error') {
              appendFileSync(checkpointPath, `${outcome.pmsBookingId}\n`);
            }
            if (index % 25 === 0 || index === total) console.log(`  processed ${index}/${total}`);
          },
        });

      outcomes = args.notify
        ? await run()
        : await ctx.bookingSync.runWithoutNotifications(run);
    }

    // ── Step 3: report ──
    const groups: Record<string, BookingSyncOutcome[]> = {};
    for (const o of outcomes) (groups[o.result] ??= []).push(o);

    console.log('\n' + '─'.repeat(72));
    console.log(args.apply ? 'Results' : 'Dry-run preview');
    for (const key of ['created', 'updated', 'cancelled', 'skipped', 'error']) {
      const n = groups[key]?.length ?? 0;
      if (n > 0) console.log(`  ${key.padEnd(10)} ${n}`);
    }

    for (const key of ['created', 'updated', 'cancelled', 'error']) {
      const items = groups[key] ?? [];
      if (items.length === 0) continue;
      console.log(`\n── ${key} (${items.length}) ${'─'.repeat(Math.max(0, 50 - key.length))}`);
      for (const o of items.slice(0, printLimit)) {
        console.log(`  ${o.pmsBookingId}${o.detail ? ` — ${o.detail}` : ''}`);
      }
      if (items.length > printLimit) {
        console.log(`  ... ${items.length - printLimit} more not shown (--json for the full list)`);
      }
    }

    const failed = groups['error'] ?? [];
    if (failed.length > 0) {
      const failPath = `backfill-failed-${tenant.slug}.txt`;
      writeFileSync(failPath, failed.map((f) => f.pmsBookingId).join('\n') + '\n');
      console.log(`\n${failed.length} failure(s) written to ${failPath} — re-run with --ids-file ${failPath}`);
    }

    // ── Step 4: post-backfill consistency ──
    let reconcileFailed = false;

    if (args.apply && !args['no-reconcile-after']) {
      const touched = outcomes.filter((o) => ['created', 'updated', 'cancelled'].includes(o.result));

      if (touched.length === 0) {
        console.log('\nNothing changed, so no reconcile needed.');
      } else {
        console.log('\nRe-deriving previousGuestCheckOutTime across all history...');
        const rows = await ctx.bookingSync.reconcilePreviousGuestCheckOut(tenant.id, null);
        console.log(`  ${rows} cleaning row(s) corrected`);

        // Backfilled bookings insert into the MIDDLE of existing chains, which
        // is exactly the case the event handlers are weakest at. Always verify.
        console.log('\nReconciling turnover chains (all history, dry run)...');
        const report = await ctx.reconcile.reconcileTenant({
          tenantId: tenant.id,
          fromDate: null,
          apply: false,
          respectUnknownSkips: true,
          verify: false,
        });
        if (report.drift.length === 0) {
          console.log('  Chains are consistent.');
        } else {
          reconcileFailed = true;
          console.log(`  ${report.drift.length} drift item(s) found across ${report.propertiesWithDrift} property(ies).`);
          console.log('  Run: npm run reconcile:turnovers -- --tenant ' + tenant.slug + ' --all-history --apply --verify');
        }
      }
    } else if (!args.apply) {
      console.log('\nThis was a dry run. Re-run with --apply to write.');
      console.log('Afterwards the script reconciles turnover chains automatically.');
    }

    if (args.json) {
      writeFileSync(
        args.json as string,
        JSON.stringify({ tenant, apply: Boolean(args.apply), ids, outcomes, notes }, null, 2),
      );
      console.log(`\nFull report written to ${args.json}`);
    }

    for (const note of notes) console.log(`\nNote: ${note}`);
    console.log(`\nElapsed: ${fmtDuration(Date.now() - startedAt)}`);

    if (failed.length > 0) return 1;
    if (reconcileFailed) return 1;
    return 0;
  } finally {
    await ctx.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
