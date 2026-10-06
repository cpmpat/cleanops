// backend/scripts/picklist-from-data.ts
//
// Fill a pick list's allowed values (dataset_picklist_values) — from the values
// the column holds right now, and/or from values you name. ADDITIVE ONLY: it
// never removes or deactivates a value, so it is also how a list is extended
// later. (To retire a value: UPDATE dataset_picklist_values SET active = false.)
//
// The field must already be bound to a pick list (dataset_fields.picklist).
// New values are appended after the existing ones, most frequent first.
//
// Usage:
//   ./scripts/prod.sh picklist:from-data -- --tenant prague-stays --dataset accommodation --field checkInMethod,terraceType
//   ./scripts/prod.sh picklist:from-data -- --tenant prague-stays --dataset accommodation --field terraceType --add "balcony terrace"
//   … --apply
//
// --add takes a comma-separated list; with it, the column's data is NOT read
// unless you also pass --from-data.

import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { DB_MODELS } from '../src/datasets/datasets.service';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const { values } = parseArgs({
  args: argv,
  options: {
    tenant: { type: 'string' },
    dataset: { type: 'string' },
    field: { type: 'string' },
    add: { type: 'string' },
    'from-data': { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.tenant || !values.dataset || !values.field || !DB_MODELS[values.dataset]) {
  console.error('Usage: pnpm picklist:from-data -- --tenant <slug> --dataset <accommodation|…> --field a,b [--add "X,Y"] [--from-data] [--apply]');
  process.exit(2);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: values.tenant! }, { slug: values.tenant! }] },
      select: { id: true, name: true },
    });
    if (!tenant) { console.error(`No tenant "${values.tenant}"`); process.exit(2); }
    const dataset = values.dataset!;
    const delegate = (prisma as any)[DB_MODELS[dataset].model];
    const manual = (values.add ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    const readData = !manual.length || values['from-data'];
    console.log(`Tenant : ${tenant.name}\nMode   : ${values.apply ? 'APPLY' : 'DRY RUN'}\n`);

    for (const field of values.field!.split(',').map((f) => f.trim()).filter(Boolean)) {
      const meta = await prisma.datasetField.findUnique({
        where: { tenantId_dataset_field: { tenantId: tenant.id, dataset, field } },
        select: { picklist: true, displayName: true },
      });
      if (!meta?.picklist) {
        console.log(`${field}: not bound to a pick list (dataset_fields.picklist is empty) — skipped`);
        continue;
      }
      const list = meta.picklist;
      const existing = await prisma.datasetPicklistValue.findMany({
        where: { tenantId: tenant.id, list },
        orderBy: { sortOrder: 'asc' },
      });
      const have = new Set(existing.map((v) => v.value));

      const candidates: Array<{ value: string; n: number | null }> = [];
      if (readData) {
        const groups: Array<Record<string, any>> = await delegate.groupBy({
          by: [field], where: { tenantId: tenant.id }, _count: { _all: true },
        });
        for (const g of groups) {
          const v = g[field] == null ? '' : String(g[field]).trim();
          if (v) candidates.push({ value: v, n: g._count._all });
        }
        candidates.sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.value.localeCompare(b.value));
      }
      for (const v of manual) candidates.push({ value: v, n: null });

      const toAdd = candidates.filter((c, i) => !have.has(c.value) && candidates.findIndex((d) => d.value === c.value) === i);
      console.log(`${field} → ${list} (${existing.length} value(s) now: ${existing.map((v) => `${v.value}${v.active ? '' : ' [inactive]'}`).join(', ') || '—'})`);
      if (!toAdd.length) { console.log('  nothing to add\n'); continue; }
      for (const c of toAdd) console.log(`  + ${JSON.stringify(c.value)}${c.n !== null ? ` (in ${c.n} row(s))` : ''}`);

      // Near-duplicates are usually typos ("seperate" / "separate"). Said, not fixed.
      const all = [...existing.map((v) => v.value), ...toAdd.map((c) => c.value)];
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = norm(all[i]); const b = norm(all[j]);
        if (a && b && a !== b && a.length === b.length && [...a].filter((ch, k) => ch !== b[k]).length <= 1) {
          console.log(`  ! "${all[i]}" and "${all[j]}" look like the same word — fix the data before allowing both`);
        }
      }

      if (values.apply) {
        let next = existing.reduce((m, v) => Math.max(m, v.sortOrder), 0);
        for (const c of toAdd) {
          await prisma.datasetPicklistValue.create({
            data: { tenantId: tenant.id, list, value: c.value, sortOrder: ++next },
          });
        }
        console.log(`  written: ${toAdd.length}`);
      }
      console.log('');
    }
    if (!values.apply) console.log('Dry run. Nothing written. Re-run with --apply.');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
