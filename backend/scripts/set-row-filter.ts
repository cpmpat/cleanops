// backend/scripts/set-row-filter.ts
//
// Restrict which ROWS of a Data list a role sees (dataset_row_filters), e.g.
// "every role except MANAGER, DIRECTOR and ADMIN sees only Accommodation rows
// whose status is Valid" (20 Oct 2026).
//
// A role's filters on different fields combine with AND (AGENT already has
// source = Avantio; adding status = Valid keeps both). The same filter is what
// Data, the top-bar search, record links, export, history and the Newsfeed use.
//
// DRY RUN IS THE DEFAULT: it prints the field's values with row counts, the
// roles affected and how many rows each will see. --apply writes.
//
// Usage:
//   ./scripts/prod.sh set:row-filter -- --tenant prague-stays --dataset accommodation --field status --values Valid
//   ./scripts/prod.sh set:row-filter -- --tenant prague-stays --dataset accommodation --field status --values Valid --apply
// Options:
//   --except MANAGER,DIRECTOR,ADMIN   roles left unfiltered (default)
//   --remove                          delete this field's filter for the roles instead
//
// Exit codes: 0 ok, 2 bad usage.

import { parseArgs } from 'node:util';
import { PrismaClient, UserRole } from '@prisma/client';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const { values } = parseArgs({
  args: argv,
  options: {
    tenant: { type: 'string' },
    dataset: { type: 'string' },
    field: { type: 'string' },
    values: { type: 'string' },
    except: { type: 'string', default: 'MANAGER,DIRECTOR,ADMIN' },
    remove: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
  },
});

/** Data lists backed by a table, and the table. */
const TABLE: Record<string, string> = { accommodation: 'cdm_accommodations' };

if (!values.tenant || !values.dataset || !values.field || (!values.values && !values.remove)) {
  console.error('Usage: pnpm set:row-filter -- --tenant <slug> --dataset accommodation --field status --values Valid[,Other] [--except R1,R2] [--remove] [--apply]');
  process.exit(2);
}
const table = TABLE[values.dataset];
if (!table) { console.error(`Unsupported list "${values.dataset}". Known: ${Object.keys(TABLE).join(', ')}`); process.exit(2); }
if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(values.field)) { console.error('Bad field name'); process.exit(2); }

const allRoles = Object.values(UserRole) as string[];
const except = new Set(values.except!.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean));
for (const r of except) if (!allRoles.includes(r)) { console.error(`"${r}" is not a role`); process.exit(2); }
const roles = allRoles.filter((r) => !except.has(r));
const wanted = (values.values ?? '').split(',').map((v) => v.trim()).filter(Boolean);

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: values.tenant! }, { slug: values.tenant! }] },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) { console.error(`No tenant "${values.tenant}"`); process.exit(2); }

    // Column name comes from the regex-checked argument; table from the map above.
    const dist = await prisma.$queryRawUnsafe<Array<{ v: string | null; n: bigint }>>(
      `SELECT "${values.field}"::text AS v, count(*) AS n FROM ${table} WHERE "tenantId" = $1 GROUP BY 1 ORDER BY 2 DESC`,
      tenant.id,
    );
    const total = dist.reduce((a, d) => a + Number(d.n), 0);
    console.log(`Tenant : ${tenant.name} (${tenant.slug})`);
    console.log(`List   : ${values.dataset} (${total} rows)`);
    console.log(`Field  : ${values.field} — values in the table:`);
    for (const d of dist) console.log(`  ${String(d.n).padStart(5)}  ${d.v === null ? '(empty)' : JSON.stringify(d.v)}`);
    const matching = dist.filter((d) => d.v !== null && wanted.includes(d.v)).reduce((a, d) => a + Number(d.n), 0);
    const missing = wanted.filter((w) => !dist.some((d) => d.v === w));
    if (!values.remove) {
      console.log(`\nFilter : ${values.field} in [${wanted.map((w) => JSON.stringify(w)).join(', ')}] → ${matching} of ${total} rows visible`);
      if (missing.length) console.log(`  warning: no row has ${missing.map((m) => JSON.stringify(m)).join(', ')} — check the spelling (it is case-sensitive)`);
    }
    console.log(`Roles  : ${roles.join(', ')}`);
    console.log(`Not filtered: ${[...except].join(', ')}`);

    const existing = await prisma.datasetRowFilter.findMany({
      where: { tenantId: tenant.id, dataset: values.dataset! },
      select: { role: true, field: true, values: true },
    });
    if (existing.length) {
      console.log('\nFilters today:');
      for (const e of existing) console.log(`  ${e.role.padEnd(22)} ${e.field} in [${e.values.join(', ')}]`);
    }

    if (!values.apply) { console.log('\nDry run. Nothing written. Re-run with --apply.'); return; }

    await prisma.$transaction(async (tx) => {
      for (const role of roles) {
        const key = { tenantId_dataset_role_field: { tenantId: tenant.id, dataset: values.dataset!, role: role as UserRole, field: values.field! } };
        if (values.remove) {
          await tx.datasetRowFilter.deleteMany({ where: { tenantId: tenant.id, dataset: values.dataset!, role: role as UserRole, field: values.field! } });
        } else {
          await tx.datasetRowFilter.upsert({
            where: key,
            create: { tenantId: tenant.id, dataset: values.dataset!, role: role as UserRole, field: values.field!, values: wanted },
            update: { values: wanted },
          });
        }
      }
      await tx.auditEvent.create({
        data: {
          tenantId: tenant.id,
          category: 'DATA_EDIT' as any,
          action: values.remove ? 'dataset.row_filter_removed' : 'dataset.row_filter_set',
          actorEmail: 'script set-row-filter',
          targetType: 'Dataset',
          targetId: values.dataset!,
          metadata: { field: values.field, values: wanted, roles, except: [...except] } as any,
        },
      });
    });
    console.log(`\nWritten for ${roles.length} role(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
