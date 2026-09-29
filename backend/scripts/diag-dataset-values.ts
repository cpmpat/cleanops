// backend/scripts/diag-dataset-values.ts
//
// READ-ONLY. For one migrated CDM list, answers two questions about the data
// before the schema commits to them:
//
//   1. Which text columns hold nothing but TRUE / FALSE (and blanks)? Those
//      become real booleans — only TRUE/FALSE accepted from then on.
//   2. Do the pick-list columns hold values outside their list? Those rows
//      would fail validation on their next save and need cleaning first.
//
// Usage (production, via the usual wrapper):
//   ./scripts/prod.sh diag:dataset-values -- --tenant prague-stays
//   ./scripts/prod.sh diag:dataset-values -- --tenant prague-stays --list user
//
// Writes nothing. Exit 0 always, unless the arguments are wrong (2).

import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values } = parseArgs({
  args: argv,
  options: {
    tenant: { type: 'string' },
    list: { type: 'string', default: 'accommodation' },
  },
});

const TABLES: Record<string, string> = {
  accommodation: 'cdm_accommodations',
  user: 'cdm_users',
};

/**
 * The pick lists agreed on 29 Sep 2026. Hard-coded here on purpose so this
 * runs against production before the migration that creates the table.
 */
const PICKLISTS: Record<string, Record<string, string[]>> = {
  accommodation: {
    source: ['Avantio', 'CRM', 'Lead'],
    status: ['Valid', 'Invalid', 'Offboarding', 'Offboarded', 'Onboarding'],
  },
};

if (!values.tenant || !TABLES[values.list!]) {
  console.error(
    'Usage: pnpm diag:dataset-values -- --tenant <id|slug> [--list accommodation|user]',
  );
  process.exit(2);
}

const fmt = (rows: { v: string; n: number }[], limit = 8) =>
  rows.slice(0, limit).map((r) => `${JSON.stringify(r.v)}×${r.n}`).join('  ') +
  (rows.length > limit ? `  … +${rows.length - limit} more` : '');

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: values.tenant! }, { slug: values.tenant! }] },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) {
      console.error(`No tenant "${values.tenant}"`);
      process.exit(2);
    }
    const list = values.list!;
    const table = TABLES[list];

    const fields = await prisma.datasetField.findMany({
      where: { tenantId: tenant.id, dataset: list },
      orderBy: { columnOrder: 'asc' },
      select: { field: true, displayName: true, type: true },
    });
    const cols = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table}`;
    const dbType = new Map(cols.map((c) => [c.column_name, c.data_type]));

    console.log(`Tenant : ${tenant.name} (${tenant.slug})`);
    console.log(`List   : ${list}  (table ${table}, ${fields.length} columns)\n`);

    const distinctOf = async (field: string) => {
      const rows = await prisma.$queryRawUnsafe<{ v: string | null; n: bigint }[]>(
        `SELECT "${field}"::text AS v, count(*) AS n FROM "${table}" WHERE "tenantId" = $1 GROUP BY 1 ORDER BY 2 DESC`,
        tenant.id,
      );
      const empty = rows
        .filter((r) => r.v === null || r.v.trim() === '')
        .reduce((a, r) => a + Number(r.n), 0);
      const filled = rows
        .filter((r) => r.v !== null && r.v.trim() !== '')
        .map((r) => ({ v: r.v as string, n: Number(r.n) }));
      return { empty, filled };
    };

    const exact: string[] = [];
    const near: string[] = [];
    const alreadyBool: string[] = [];

    for (const f of fields) {
      // Identifiers come from our own metadata, but they are interpolated
      // into SQL — accept only plain column names.
      if (!/^[A-Za-z0-9_]+$/.test(f.field)) continue;
      const t = dbType.get(f.field);
      if (t === 'boolean') { alreadyBool.push(f.field); continue; }
      if (t !== 'text') continue;

      const { empty, filled } = await distinctOf(f.field);
      if (filled.length === 0) continue;
      const isTF = (v: string) => ['TRUE', 'FALSE'].includes(v.trim().toUpperCase());
      const tf = filled.filter((r) => isTF(r.v)).reduce((a, r) => a + r.n, 0);
      const total = filled.reduce((a, r) => a + r.n, 0);

      const line = `  ${f.field.padEnd(34)} ${fmt(filled)}   (empty ${empty})`;
      if (tf === total) exact.push(line);
      else if (tf / total >= 0.8) near.push(line);
    }

    console.log('ALREADY BOOLEAN IN THE DATABASE');
    console.log(alreadyBool.length ? '  ' + alreadyBool.join(', ') : '  (none)');

    console.log('\nONLY TRUE/FALSE (and blanks) — will become boolean');
    console.log(exact.length ? exact.join('\n') : '  (none)');

    console.log('\nMOSTLY TRUE/FALSE, but with other values — decide by hand');
    console.log(near.length ? near.join('\n') : '  (none)');

    const lists = PICKLISTS[list] ?? {};
    for (const [field, allowed] of Object.entries(lists)) {
      if (!dbType.has(field)) continue;
      const { empty, filled } = await distinctOf(field);
      const outside = filled.filter((r) => !allowed.includes(r.v));
      console.log(`\nPICK LIST ${field}: allowed ${allowed.join(', ')}`);
      console.log(`  in the data: ${fmt(filled, 20)}   (empty ${empty})`);
      console.log(
        outside.length
          ? `  NOT IN THE LIST: ${fmt(outside, 20)}  ← these rows cannot be saved until fixed`
          : '  every value is in the list',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
