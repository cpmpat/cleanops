#!/usr/bin/env ts-node
/**
 * refresh-oxpoint-lookups.ts
 *
 * Re-copies Accommodation's OX Point columns (oxpointCity … oxpointAccessibilitysummary,
 * sheet FW–GF) from cdm_ox_point, matching accommodation.oxPointId to the OX
 * Point's code (`id`). The app keeps them in step on every edit; run this after
 * a sheet reload of either list, or to check the two agree.
 *
 * DRY RUN IS THE DEFAULT: prints how many rows and cells differ, per column,
 * and every oxPointId that matches no OX Point. No values are printed (two of
 * the columns are access codes).
 *
 * Usage:
 *   ./scripts/prod.sh refresh:oxpoint-lookups -- --tenant prague-stays
 *   ./scripts/prod.sh refresh:oxpoint-lookups -- --tenant prague-stays --apply
 *
 * --apply records every change in the history (actor "oxpoint lookup", role IMPORT).
 */

import { parseArgs } from 'node:util';
import { bootScriptContext, resolveTenant } from './lib/script-context';
import { OX_LOOKUP_FIELDS, syncOxLookups } from '../src/datasets/oxpoint-lookup';

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const { values } = parseArgs({
    args: argv,
    options: { tenant: { type: 'string' }, apply: { type: 'boolean', default: false } },
  });
  if (!values.tenant) {
    console.error('Missing --tenant <id|slug>');
    process.exit(2);
  }
  const ctx = await bootScriptContext({ quiet: true });
  try {
    const tenant = await resolveTenant(ctx.prisma, values.tenant);
    console.log(`\nTenant: ${tenant.name} (${tenant.slug})`);
    console.log(values.apply ? 'Mode:   APPLY' : 'Mode:   DRY RUN — nothing will be written');

    const run = (apply: boolean) =>
      ctx.prisma.$transaction(
        (tx) => syncOxLookups(tx, tenant.id, {
          apply,
          actorEmail: 'oxpoint lookup',
          actorRole: 'IMPORT',
          action: 'dataset.accommodation.oxpoint_lookup',
        }),
        { timeout: 120_000 },
      );
    const r = await run(!!values.apply);

    console.log(`\nAccommodations checked: ${r.checked}`);
    console.log(`Rows that ${values.apply ? 'changed' : 'would change'}: ${r.changedRows} (${r.changedCells} cells)`);
    for (const f of OX_LOOKUP_FIELDS) if (r.byField[f]) console.log(`  ${f.padEnd(30)} ${r.byField[f]}`);
    if (r.unmatched.length) {
      console.log(`\n${r.unmatched.length} accommodation(s) with an oxPointId that matches no OX Point code — left as they are:`);
      for (const u of r.unmatched.slice(0, 40)) console.log(`  ${String(u.idAvantio ?? '?').padEnd(10)} oxPointId ${u.oxPointId}`);
      if (r.unmatched.length > 40) console.log(`  … and ${r.unmatched.length - 40} more`);
    }
    if (!values.apply && r.changedRows) console.log('\nDry run — re-run with --apply to write.');
    console.log('');
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
