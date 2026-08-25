#!/usr/bin/env ts-node
/**
 * reconcile-turnovers.ts
 *
 * Checks (and optionally repairs) the turnover chain against the bookings
 * table, which is the source of truth.
 *
 * Turnovers are only ever written by event handlers whose errors are swallowed
 * (BookingSyncService.safelyRunTurnoverSync), and the whole dual-write sits
 * behind TURNOVER_SYNC_ENABLED. So the chain can drift, and nothing else in the
 * system notices. This script is the detector; --apply makes it the repair tool.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless you pass --apply.
 *
 * Usage:
 *   npm run reconcile:turnovers -- --tenant prague-stays
 *   npm run reconcile:turnovers -- --tenant prague-stays --since 30d
 *   npm run reconcile:turnovers -- --tenant prague-stays --apply --verify
 *   npm run reconcile:turnovers -- --tenant prague-stays --fail-on-drift   # for cron
 *
 * Options:
 *   --tenant <id|slug>     required
 *   --property <ref>       repeatable / comma-separated; Property.id or pmsPropertyId
 *   --since <7d|ISO>       only bookings arriving at/after this (default 7d)
 *   --all-history          examine every booking — slow, use deliberately
 *   --apply                write the repairs (default: report only)
 *   --verify               after applying, re-check and fail loudly if drift remains
 *   --include-unknown-skips  also re-thread SKIPPED rows with no skipReason
 *   --orphan-window <days>   only auto-cancel orphans a cleaner could still act
 *                            on (default 2, matching the pool cutoff). Use a big
 *                            number to clear historical orphans too.
 *   --json <path>          write the full machine-readable report
 *   --fail-on-drift        exit 1 when drift is found (health check mode)
 *   --limit-output <n>     max drift lines printed per kind (default 20)
 *
 * Exit codes:
 *   0  clean, or drift found without --fail-on-drift
 *   1  drift found with --fail-on-drift, or apply did not converge, or a
 *      property transaction failed
 *   2  bad usage
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import {
  bootScriptContext,
  resolveTenant,
  parseSince,
  splitList,
  fmtDuration,
} from './lib/script-context';
import type { DriftKind, ReconcileReport } from '../src/integrations/turnover-reconcile.service';

const KIND_ORDER: DriftKind[] = [
  'MISSING',
  'STALE_ENDPOINT',
  'TIME_DRIFT',
  'IMPOSSIBLE_WINDOW',
  'DUPLICATE_ACTIVE',
  'ORPHAN',
  'CHAIN_CYCLE',
  'LEGACY_MERGE',
];

async function main(): Promise<number> {
  // npm strips the `--` separator before handing argv to the script; pnpm
  // forwards it verbatim. parseArgs treats a literal `--` as end-of-options and
  // then rejects everything after it as a positional, so `pnpm run x -- --tenant y`
  // would die with "does not take positional arguments". Drop a leading `--` so
  // the same command line works under either runner.
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        tenant: { type: 'string' },
        property: { type: 'string', multiple: true },
        since: { type: 'string' },
        'all-history': { type: 'boolean', default: false },
        apply: { type: 'boolean', default: false },
        verify: { type: 'boolean', default: false },
        'include-unknown-skips': { type: 'boolean', default: false },
        'orphan-window': { type: 'string' },
        json: { type: 'string' },
        'fail-on-drift': { type: 'boolean', default: false },
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

  if (args.help || !args.tenant) {
    console.error(
      'Usage: reconcile-turnovers --tenant <id|slug> [--since 7d|--all-history] ' +
      '[--property ref] [--apply] [--verify] [--json path] [--fail-on-drift]',
    );
    return args.help ? 0 : 2;
  }

  const printLimit = Math.max(1, parseInt(args['limit-output'] as string, 10) || 20);
  const orphanWindow = args['orphan-window']
    ? Math.max(0, parseInt(args['orphan-window'] as string, 10))
    : undefined;
  const startedAt = Date.now();
  const ctx = await bootScriptContext({ quiet: true });

  try {
    const tenant = await resolveTenant(ctx.prisma, args.tenant as string);

    // Property refs may be internal ids or Avantio accommodation ids.
    const propertyRefs = splitList(args.property);
    let propertyIds: string[] | undefined;
    if (propertyRefs.length > 0) {
      const found = await ctx.prisma.property.findMany({
        where: {
          tenantId: tenant.id,
          OR: [{ id: { in: propertyRefs } }, { pmsPropertyId: { in: propertyRefs } }],
        },
        select: { id: true, name: true, pmsPropertyId: true },
      });
      if (found.length === 0) {
        console.error(`No properties matched: ${propertyRefs.join(', ')}`);
        return 2;
      }
      if (found.length < propertyRefs.length) {
        console.error(
          `WARNING: matched ${found.length} of ${propertyRefs.length} property refs — ` +
          `unmatched refs are ignored.`,
        );
      }
      propertyIds = found.map((p) => p.id);
    }

    const fromDate = args['all-history']
      ? null
      : parseSince((args.since as string) ?? '7d');

    console.log('─'.repeat(72));
    console.log(`Turnover chain reconciliation — ${tenant.name} (${tenant.slug})`);
    console.log(`Mode:     ${args.apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
    console.log(`Window:   ${fromDate ? `bookings arriving >= ${fromDate.toISOString()}` : 'all history'}`);
    console.log(`Scope:    ${propertyIds ? `${propertyIds.length} propert${propertyIds.length === 1 ? 'y' : 'ies'}` : 'all properties'}`);
    console.log(
      `Orphans:  auto-cancel only within ${orphanWindow ?? 2} day(s) of now ` +
      `(older ones are counted, not touched)`,
    );
    if (process.env.TURNOVER_SYNC_ENABLED !== 'true') {
      console.log(
        'NOTE:     TURNOVER_SYNC_ENABLED is not "true" in this environment. If that\n' +
        '          also holds for the API process, the chain will drift again as soon\n' +
        '          as new bookings arrive — this run only fixes the current state.',
      );
    }
    console.log('─'.repeat(72));

    const report: ReconcileReport = await ctx.reconcile.reconcileTenant({
      tenantId: tenant.id,
      propertyIds,
      fromDate,
      apply: Boolean(args.apply),
      respectUnknownSkips: !args['include-unknown-skips'],
      verify: Boolean(args.verify),
      orphanVisibilityDays: orphanWindow,
      onProgress: (done, total, name) => {
        // One line, rewritten in place, so a long run visibly moves. Without
        // it the script prints the header and then nothing for minutes, which
        // is indistinguishable from a hang and gets killed with ^C.
        const label = name.length > 40 ? `${name.slice(0, 39)}…` : name;
        const line = `  [${String(done).padStart(String(total).length)}/${total}] ${label}`;
        if (process.stdout.isTTY) {
          process.stdout.write(`\r${line.padEnd(60)}`);
          if (done === total) process.stdout.write('\n');
        } else if (done === 1 || done % 25 === 0 || done === total) {
          console.log(line);
        }
      },
    });

    printReport(report, printLimit);

    if (args.json) {
      writeFileSync(args.json as string, JSON.stringify(report, null, 2));
      console.log(`\nFull report written to ${args.json}`);
    }

    console.log(`\nElapsed: ${fmtDuration(Date.now() - startedAt)}`);

    if (report.errors.length > 0) return 1;
    if (report.verifyFailures.length > 0) return 1;
    if (args['fail-on-drift'] && report.drift.length > 0) return 1;
    return 0;
  } finally {
    await ctx.close();
  }
}

function printReport(report: ReconcileReport, printLimit: number): void {
  const { drift } = report;

  console.log(
    `\nScanned ${report.propertiesScanned} properties / ` +
    `${report.bookingsConsidered} bookings. ` +
    `${report.propertiesWithDrift} propert${report.propertiesWithDrift === 1 ? 'y' : 'ies'} with drift.`,
  );

  if (drift.length === 0) {
    console.log('\nNo drift. The turnover chain matches the bookings table.');
    return;
  }

  console.log('\nDrift by kind:');
  for (const kind of KIND_ORDER) {
    const n = report.counts[kind];
    if (n > 0) console.log(`  ${kind.padEnd(18)} ${n}`);
  }
  console.log(
    `\n  ${report.apply ? 'applied' : 'would apply'}: ${report.apply ? report.appliedCount : drift.length - report.needsReviewCount}` +
    `   needs human review: ${report.needsReviewCount}`,
  );

  for (const kind of KIND_ORDER) {
    const items = drift.filter((d) => d.kind === kind);
    if (items.length === 0) continue;

    console.log(`\n── ${kind} (${items.length}) ${'─'.repeat(Math.max(0, 50 - kind.length))}`);
    for (const item of items.slice(0, printLimit)) {
      console.log(`  ${item.propertyName}`);
      console.log(`    ${item.detail}`);
      console.log(
        `    ${item.needsReview ? 'REVIEW: ' : item.applied ? 'applied: ' : 'would: '}${item.action}`,
      );
    }
    if (items.length > printLimit) {
      console.log(
        `  ... ${items.length - printLimit} more ${kind} item(s) not shown ` +
        `(raise --limit-output or use --json to see all)`,
      );
    }
  }

  if (report.needsReviewCount > 0) {
    console.log(
      `\n${report.needsReviewCount} item(s) were left untouched on purpose — ` +
      `they carry started or completed work, or they need a decision the ` +
      `reconciler is not entitled to make. Read the REVIEW line on each: ` +
      `some belong in the UI, some in the PMS.`,
    );
  }

  for (const note of report.excluded) console.log(`\nScope note: ${note}`);

  if (report.errors.length > 0) {
    console.log(`\n${report.errors.length} propert(ies) FAILED — their drift is unfixed:`);
    for (const e of report.errors) console.log(`  ${e.propertyName} (${e.propertyId}): ${e.message}`);
  }

  if (report.verifyFailures.length > 0) {
    console.log('\nVERIFY FAILED — drift survived --apply. This is a bug in the reconciler,');
    console.log('not stale data. Do not re-run blindly; investigate:');
    for (const f of report.verifyFailures) console.log(`  ${f}`);
  }

  if (!report.apply) {
    console.log('\nThis was a dry run. Re-run with --apply --verify to write the repairs.');
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
