#!/usr/bin/env ts-node
/**
 * safety-sweep.ts — run the nightly safety sweep by hand.
 *
 * Same code the server runs at 03:20 Prague (SafetySweepService): sync the
 * bookings Avantio updated in the window that are missing here, then reconcile
 * the turnover chain over bookings arriving in the window.
 *
 * DRY RUN IS THE DEFAULT. With --apply it writes, sends the usual booking
 * notifications for bookings it creates, and records a 'sweep.completed' audit
 * row exactly like the nightly run.
 *
 * Usage:
 *   ./scripts/prod.sh sweep:run -- --tenant prague-stays
 *   ./scripts/prod.sh sweep:run -- --tenant prague-stays --apply
 *   ./scripts/prod.sh sweep:run -- --tenant prague-stays --days 14
 *
 * Exit codes: 0 clean or report · 1 the sweep stopped on an error or apply
 * did not converge · 2 bad usage
 */

import { parseArgs } from 'node:util';
import { bootScriptContext, resolveTenant } from './lib/script-context';

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const { values } = parseArgs({
    args: argv,
    options: {
      tenant: { type: 'string' },
      apply: { type: 'boolean', default: false },
      days: { type: 'string' },
    },
  });
  if (!values.tenant) {
    console.error('Missing --tenant <id|slug>');
    process.exit(2);
  }
  const days = values.days ? Number(values.days) : 7;
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days must be a positive number');
    process.exit(2);
  }

  // Not quiet: the sweep reports through the Nest logger, as on the server.
  const ctx = await bootScriptContext({ quiet: false });
  try {
    const tenant = await resolveTenant(ctx.prisma, values.tenant);
    const r = await ctx.sweep.sweepTenant({ tenantId: tenant.id, apply: !!values.apply, windowDays: days });
    const t = r.turnovers;
    const failed = !!r.error || (!('skipped' in t) && (t.verifyFailures.length > 0 || t.errors.length > 0));
    if (!values.apply) console.log('\nDry run — nothing written. Re-run with --apply to write.');
    process.exit(failed ? 1 : 0);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
