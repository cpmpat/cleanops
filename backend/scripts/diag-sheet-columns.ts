// backend/scripts/diag-sheet-columns.ts
//
// READ-ONLY. Describes the columns of one CDM sheet tab — names, mapping
// labels, how full they are and what type their values look like — WITHOUT
// printing any value. Used to plan a migration (a new column, a list moving
// into Postgres) from what the sheet really holds.
//
// --distinct prints the distinct values (with counts) of the named columns
// only, for pick lists. Never pass a credential or personal column there.
//
// Usage:
//   ./scripts/prod.sh diag:sheet-columns -- --tenant prague-stays --tab Accommodation --model CdmAccommodation
//   ./scripts/prod.sh diag:sheet-columns -- --tenant prague-stays --tab Owner
//   ./scripts/prod.sh diag:sheet-columns -- --tenant prague-stays --tab Accommodation --distinct checkInMethod,terraceType
//
// Writes nothing.

import { parseArgs } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { GoogleSheetsClient } from '../src/datasets/google-sheets.client';
import { squash } from '../src/datasets/datasets.service';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const { values } = parseArgs({
  args: argv,
  options: {
    tenant: { type: 'string' },
    tab: { type: 'string' },
    model: { type: 'string' },
    distinct: { type: 'string' },
    'only-new': { type: 'boolean', default: false },
  },
});
if (!values.tenant || !values.tab) {
  console.error('Usage: pnpm diag:sheet-columns -- --tenant <slug> --tab <Tab> [--model CdmAccommodation] [--only-new] [--distinct a,b]');
  process.exit(2);
}

function dbName(sheetName: string): string {
  const ascii = sheetName.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const safe = ascii.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z]/.test(safe) ? safe : `f${safe}`;
}
function letter(n: number): string {
  let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
function kindOf(vals: string[]): string {
  if (vals.length === 0) return 'empty';
  if (vals.every((v) => /^(TRUE|FALSE)$/i.test(v))) return 'bool';
  if (vals.every((v) => /^-?\d+$/.test(v))) return 'int';
  if (vals.every((v) => /^-?\d+([.,]\d+)?$/.test(v))) return 'float';
  if (vals.every((v) => /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\.\s?\d{1,2}\.\s?\d{4}$/.test(v))) return 'date';
  if (vals.every((v) => /^https?:\/\//i.test(v))) return 'url';
  return 'text';
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: values.tenant! }, { slug: values.tenant! }] },
      select: { name: true, datasetsSheetId: true },
    });
    if (!tenant?.datasetsSheetId) { console.error('No tenant / no datasetsSheetId'); process.exit(2); }
    const sheets = new GoogleSheetsClient();
    const tabs = await sheets.listTabs(tenant.datasetsSheetId);
    const tab = tabs.find((t) => t === values.tab) ?? tabs.find((t) => squash(t) === squash(values.tab!));
    if (!tab) { console.error(`No tab "${values.tab}". Tabs: ${tabs.join(', ')}`); process.exit(2); }
    const mapTab = tabs.find((t) => squash(t) === squash(`mapping${tab}`)) ?? null;

    const { columns, rows } = await sheets.readTab(tenant.datasetsSheetId, tab);
    const labels = new Map<string, string>();
    if (mapTab) {
      for (const r of ((await sheets.readValues(tenant.datasetsSheetId, mapTab)) ?? []).slice(1)) {
        const src = (r[1] ?? '').trim();
        if (src && !labels.has(src)) labels.set(src, (r[3] ?? '').trim());
      }
    }
    const modelFields = values.model
      ? new Set(Prisma.dmmf.datamodel.models.find((m) => m.name === values.model)?.fields.map((f) => f.name) ?? [])
      : null;

    console.log(`Tab     : ${tab} — ${rows.length} row(s) × ${columns.length} column(s)`);
    console.log(`Mapping : ${mapTab ?? '(none)'}`);
    if (modelFields) console.log(`Model   : ${values.model} (${modelFields.size} fields)`);
    console.log('\ncol  header -> db name                         filled  type   maxLen  in model  label');
    for (let i = 0; i < columns.length; i++) {
      const h = columns[i];
      const db = dbName(h);
      const inModel = modelFields ? (modelFields.has(db) ? 'yes' : 'NO') : '-';
      if (values['only-new'] && inModel !== 'NO') continue;
      const vals = rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
      const maxLen = vals.reduce((m, v) => Math.max(m, v.length), 0);
      console.log(
        `${letter(i + 1).padEnd(4)} ${(h === db ? h : `${h} -> ${db}`).padEnd(40)} ${String(vals.length).padStart(6)}  ${kindOf(vals).padEnd(6)} ${String(maxLen).padStart(6)}  ${inModel.padEnd(8)}  ${labels.get(h) ?? ''}`,
      );
    }
    const inMapNotData = [...labels.keys()].filter((k) => !columns.includes(k));
    if (inMapNotData.length) console.log(`\nIn ${mapTab} but not in the data tab: ${inMapNotData.join(', ')}`);

    for (const name of (values.distinct ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const i = columns.findIndex((c) => c === name || squash(c) === squash(name));
      if (i < 0) { console.log(`\n--distinct ${name}: no such column`); continue; }
      const counts = new Map<string, number>();
      let empty = 0;
      for (const r of rows) {
        const v = (r[i] ?? '').trim();
        if (!v) { empty++; continue; }
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      console.log(`\nDISTINCT ${columns[i]} (${counts.size} values, ${empty} empty):`);
      for (const [v, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${JSON.stringify(v)} ×${n}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
