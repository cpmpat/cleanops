// backend/scripts/import-notify-matrix.ts
//
// Load the NOTIFY matrix — which field changes each role sees in
// Notifications → Data — from a CSV into dataset_field_notify.
//
// CSV SHAPE (one column per role, one row per field):
//
//   field,ADMIN,MANAGER,FRONT_DESK_MANAGER,EVIDENCE
//   titleAvantio,TRUE,TRUE,TRUE,FALSE
//   …
//
// A role is shown a change only if this file says TRUE *and* the access
// matrix lets it view the field — notify can narrow what a role sees, never
// widen it.
//
// SEMANTICS: as import:access-matrix — for the roles in the file and the given
// list, the file is the whole truth; roles not in the file are untouched.
// Dry run by default; --apply writes in one transaction with an audit event.
//
// Usage:
//   ./scripts/prod.sh import:notify-matrix -- --tenant prague-stays --dataset accommodation --csv ../docs/notify-matrix/accommodation.csv
//   … --apply

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PrismaClient, UserRole } from '@prisma/client';
import { TABS } from '../src/datasets/datasets.service';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const { values } = parseArgs({
  args: argv,
  options: {
    tenant: { type: 'string' },
    dataset: { type: 'string' },
    csv: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});
if (!values.tenant || !values.dataset || !values.csv) {
  console.error('Usage: pnpm import:notify-matrix -- --tenant <slug> --dataset <accommodation|owner|…> --csv <file> [--apply]');
  process.exit(2);
}
if (!TABS.some((t) => t.key === values.dataset)) {
  console.error(`Unknown list "${values.dataset}". Known: ${TABS.map((t) => t.key).join(', ')}`);
  process.exit(2);
}

const ALIASES: Record<string, Record<string, string>> = {
  accommodation: { 'vítejEspId': 'vitejEspId' },
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function main() {
  const dataset = values.dataset!;
  const rows = parseCsv(readFileSync(values.csv!.replace(/^~(?=\/)/, process.env.HOME ?? '~'), 'utf8').replace(/^﻿/, ''));
  if (rows.length < 2) { console.error('The file needs a header row and at least one field row.'); process.exit(1); }

  const known = new Set(Object.values(UserRole) as string[]);
  const errors: string[] = [];
  const roles: { role: string; col: number }[] = [];
  rows[0].forEach((c, i) => {
    if (i === 0) return;
    const role = c.trim().toUpperCase();
    if (!role) return;
    if (!known.has(role)) errors.push(`Row 1: "${c}" is not a role`);
    roles.push({ role, col: i });
  });
  if (!roles.length) errors.push('Row 1 names no role');

  const alias = ALIASES[dataset] ?? {};
  const wanted: { field: string; role: string; notify: boolean }[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, n) => {
    const raw = (r[0] ?? '').trim();
    if (!raw) return;
    const field = alias[raw] ?? raw;
    if (seen.has(field)) { errors.push(`Row ${n + 2}: "${raw}" appears twice`); return; }
    seen.add(field);
    for (const { role, col } of roles) {
      const v = (r[col] ?? '').trim().toUpperCase();
      if (v !== 'TRUE' && v !== 'FALSE' && v !== '') errors.push(`Row ${n + 2} ${role}: "${r[col]}" is not TRUE or FALSE`);
      wanted.push({ field, role, notify: v === 'TRUE' });
    }
  });
  if (errors.length) {
    console.error(`${errors.length} problem(s) — nothing written:`);
    for (const e of errors.slice(0, 40)) console.error(`  ${e}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: values.tenant! }, { slug: values.tenant! }] },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) { console.error(`No tenant "${values.tenant}"`); process.exit(2); }

    const key = (g: { field: string; role: string }) => `${g.role}:${g.field}`;
    const current = await prisma.datasetFieldNotify.findMany({
      where: { tenantId: tenant.id, dataset, role: { in: roles.map((r) => r.role) as UserRole[] } },
    });
    const before = new Map(current.map((g) => [key(g), g]));
    const after = new Map(wanted.map((g) => [key(g), g]));
    const added = wanted.filter((g) => !before.has(key(g)) && g.notify);
    const changed = wanted.filter((g) => before.has(key(g)) && before.get(key(g))!.notify !== g.notify);
    const removed = current.filter((g) => !after.has(key(g)));

    // Notified but not viewable: allowed in the file, but nothing will show.
    const viewable = new Set(
      (await prisma.datasetFieldAccess.findMany({
        where: { tenantId: tenant.id, dataset, canView: true, role: { in: roles.map((r) => r.role) as UserRole[] } },
        select: { role: true, field: true },
      })).map(key),
    );
    const blind = wanted.filter((g) => g.notify && !viewable.has(key(g)));

    console.log(`Tenant : ${tenant.name} (${tenant.slug})`);
    console.log(`List   : ${dataset}`);
    console.log(`File   : ${values.csv} — ${seen.size} field(s) × ${roles.length} role(s)`);
    console.log(`Mode   : ${values.apply ? 'APPLY' : 'DRY RUN'}\n`);
    for (const { role } of roles) {
      console.log(`  ${role.padEnd(20)} notify ${wanted.filter((g) => g.role === role && g.notify).length}`);
    }
    console.log(`\nChanges: +${added.length} new, ~${changed.length} changed, -${removed.length} removed`);
    for (const g of changed.slice(0, 30)) console.log(`  ~ ${g.role} ${g.field}: ${g.notify ? 'off → on' : 'on → off'}`);
    for (const g of removed.slice(0, 30)) console.log(`  - ${g.role} ${g.field} (not in the file)`);
    if (blind.length) {
      console.log(`\n${blind.length} notify grant(s) on fields the role cannot view — stored, but they show nothing until the access matrix grants view:`);
      console.log('  ' + blind.slice(0, 40).map((g) => `${g.role}:${g.field}`).join('  '));
    }

    if (!values.apply) { console.log('\nDry run. Nothing written. Re-run with --apply.'); return; }

    await prisma.$transaction(async (tx) => {
      for (const g of wanted) {
        await tx.datasetFieldNotify.upsert({
          where: { tenantId_dataset_field_role: { tenantId: tenant.id, dataset, field: g.field, role: g.role as UserRole } },
          create: { tenantId: tenant.id, dataset, field: g.field, role: g.role as UserRole, notify: g.notify },
          update: { notify: g.notify },
        });
      }
      if (removed.length) await tx.datasetFieldNotify.deleteMany({ where: { id: { in: removed.map((g) => g.id) } } });
      await tx.auditEvent.create({
        data: {
          tenantId: tenant.id,
          category: 'DATA_EDIT',
          action: `dataset.${dataset}.notify-matrix.import`,
          actorEmail: process.env.USER ? `script:${process.env.USER}` : 'script',
          targetType: `dataset:${dataset}`,
          metadata: {
            file: values.csv!.split('/').pop(),
            roles: roles.map((r) => r.role),
            added: added.length, changed: changed.length, removed: removed.length,
          },
        },
      });
    }, { timeout: 300_000, maxWait: 20_000 });
    console.log('\nWritten.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
