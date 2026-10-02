// backend/scripts/import-access-matrix.ts
//
// Load the dataset access matrix from the CSV Patrik maintains
// (matrixFieldsAccessRoles.csv) into dataset_field_access.
//
// CSV SHAPE — the one the matrix is kept in:
//
//   ,FRONT_DESK_MANAGER,,FRONT_DESK,
//   field,view,edit,view,edit
//   source,TRUE,FALSE,TRUE,FALSE
//   …
//
// Row 1 names a role over each view/edit pair; row 2 is the pair's header;
// every row after that is one column of the list. Any number of roles.
//
// SEMANTICS: for the roles in the file and the given list, the file is the
// whole truth. Every row is upserted; a grant those roles hold on a column the
// file no longer names is removed. Roles not in the file are not touched.
//
// DRY RUN IS THE DEFAULT. It prints what would change. --apply writes it, in
// one transaction, with an audit event.
//
// Usage:
//   ./scripts/prod.sh import:access-matrix -- --tenant prague-stays --dataset accommodation --csv ~/Downloads/matrix.csv
//   ./scripts/prod.sh import:access-matrix -- --tenant prague-stays --dataset accommodation --csv ~/Downloads/matrix.csv --apply
//
// SHEET-BACKED LISTS (owner): the grants are matched against the live header
// row of the sheet tab instead of dataset_fields, compared squashed (case,
// spaces, punctuation ignored). They are view-only — the app cannot write to
// the sheet — so an edit grant there is stored but means nothing more than view.
//
// Exit codes: 0 ok, 1 the file has errors (nothing written), 2 bad usage.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PrismaClient, UserRole } from '@prisma/client';
import { GoogleSheetsClient } from '../src/datasets/google-sheets.client';
import { TABS, squash } from '../src/datasets/datasets.service';

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
  console.error(
    'Usage: pnpm import:access-matrix -- --tenant <id|slug> --dataset <accommodation|user|owner|oxpoint> --csv <file> [--apply]',
  );
  process.exit(2);
}
const TAB = TABS.find((t) => t.key === values.dataset);
if (!TAB) {
  console.error(`Unknown list "${values.dataset}". Known: ${TABS.map((t) => t.key).join(', ')}`);
  process.exit(2);
}

/**
 * Names the matrix uses that differ from the table's column names. The first
 * four came from the 29 Sep 2026 file; add to this rather than renaming
 * columns.
 */
const ALIASES: Record<string, Record<string, string>> = {
  accommodation: {
    urlListingAirbnb: 'linkListingAirbnb',
    dateContractTermination: 'contractTerminated',
    parkingNumber: 'parkingLotNumber',
    'vítejEspId': 'espId',
  },
};

/** Minimal CSV: commas, double-quoted cells with "" escapes, CRLF or LF. */
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

type Grant = { field: string; role: string; canView: boolean; canEdit: boolean };

async function main() {
  const dataset = values.dataset!;
  const text = readFileSync(values.csv!.replace(/^~(?=\/)/, process.env.HOME ?? '~'), 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  if (rows.length < 3) {
    console.error('The file needs a role row, a view/edit row and at least one field row.');
    process.exit(1);
  }

  const knownRoles = new Set(Object.values(UserRole) as string[]);
  const errors: string[] = [];

  // Roles: a name in row 1 heads a view column; its edit column is the next.
  const roles: { role: string; view: number; edit: number }[] = [];
  rows[0].forEach((c, i) => {
    const role = c.trim().toUpperCase();
    if (!role || i === 0) return;
    if (knownRoles.size && !knownRoles.has(role)) errors.push(`Row 1: "${c}" is not a role`);
    roles.push({ role, view: i, edit: i + 1 });
  });
  if (roles.length === 0) errors.push('Row 1 names no role');

  const alias = ALIASES[dataset] ?? {};
  const grants: Grant[] = [];
  const seen = new Set<string>();
  const bool = (raw: string | undefined, where: string): boolean => {
    const v = (raw ?? '').trim().toUpperCase();
    if (v === 'TRUE') return true;
    if (v === 'FALSE' || v === '') return false;
    errors.push(`${where}: "${raw}" is not TRUE or FALSE`);
    return false;
  };

  rows.slice(2).forEach((r, n) => {
    const line = n + 3;
    const raw = (r[0] ?? '').trim();
    if (!raw) return;
    const field = alias[raw] ?? raw;
    if (seen.has(field)) { errors.push(`Row ${line}: "${raw}" appears twice`); return; }
    seen.add(field);
    for (const { role, view, edit } of roles) {
      const canView = bool(r[view], `Row ${line} ${role} view`);
      const canEdit = bool(r[edit], `Row ${line} ${role} edit`);
      if (canEdit && !canView) errors.push(`Row ${line}: ${role} may edit "${raw}" but not view it`);
      grants.push({ field, role, canView, canEdit });
    }
  });

  if (errors.length) {
    console.error(`${errors.length} problem(s) in ${values.csv} — nothing written:`);
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

    // What the list's columns are called: dataset_fields for a migrated list,
    // the sheet's own header row for a sheet-backed one.
    const isSheet = TAB!.source === 'sheet';
    let columns: Set<string>;
    if (isSheet) {
      const t = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { datasetsSheetId: true } });
      if (!t?.datasetsSheetId) { console.error('This tenant has no datasetsSheetId.'); process.exit(2); }
      const { columns: header } = await new GoogleSheetsClient().readTab(t.datasetsSheetId, TAB!.tab);
      columns = new Set(header.map(squash));
    } else {
      columns = new Set(
        (await prisma.datasetField.findMany({ where: { tenantId: tenant.id, dataset }, select: { field: true } }))
          .map((f) => f.field),
      );
    }
    const current = await prisma.datasetFieldAccess.findMany({
      where: { tenantId: tenant.id, dataset, role: { in: roles.map((r) => r.role) as any } },
    });
    const key = (g: { field: string; role: string }) => `${g.role}:${g.field}`;
    const before = new Map(current.map((g) => [key(g), g]));
    const after = new Map(grants.map((g) => [key(g), g]));

    const added = grants.filter((g) => !before.has(key(g)) && (g.canView || g.canEdit));
    const changed = grants.filter((g) => {
      const b = before.get(key(g));
      return b && (b.canView !== g.canView || b.canEdit !== g.canEdit);
    });
    const removed = current.filter((g) => !after.has(key(g)));
    const unknown = [...seen].filter((f) => !columns.has(isSheet ? squash(f) : f));

    console.log(`Tenant  : ${tenant.name} (${tenant.slug})`);
    console.log(`List    : ${dataset} (${columns.size} columns ${isSheet ? `in the "${TAB!.tab}" sheet tab — sheet-backed, view only` : 'in dataset_fields'})`);
    console.log(`File    : ${values.csv} — ${seen.size} field(s) × ${roles.length} role(s)`);
    console.log(`Mode    : ${values.apply ? 'APPLY' : 'DRY RUN'}\n`);
    for (const { role } of roles) {
      const mine = grants.filter((g) => g.role === role);
      console.log(`  ${role.padEnd(20)} view ${mine.filter((g) => g.canView).length}, edit ${mine.filter((g) => g.canEdit).length}`);
    }
    console.log(`\nChanges: +${added.length} new, ~${changed.length} changed, -${removed.length} removed`);
    for (const g of changed.slice(0, 30)) {
      const b = before.get(key(g))!;
      console.log(`  ~ ${g.role} ${g.field}: ${b.canEdit ? 'edit' : b.canView ? 'view' : 'none'} → ${g.canEdit ? 'edit' : g.canView ? 'view' : 'none'}`);
    }
    for (const g of removed.slice(0, 30)) console.log(`  - ${g.role} ${g.field} (not in the file)`);
    if (unknown.length) {
      console.log(
        isSheet
          ? `\n${unknown.length} field(s) in the file match no header in the "${TAB!.tab}" tab — stored, but nobody sees them until the names match:`
          : `\n${unknown.length} field(s) in the file are not columns of "${dataset}" yet — stored, they apply once the column exists:`,
      );
      console.log(`  ${unknown.join(', ')}`);
    }
    if (isSheet && grants.some((g) => g.canEdit)) {
      console.log('\nNote: edit grants on a sheet-backed list are stored but act as view — the app cannot write to the sheet.');
    }

    if (!values.apply) {
      console.log('\nDry run. Nothing written. Re-run with --apply.');
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const g of grants) {
        await tx.datasetFieldAccess.upsert({
          where: { tenantId_dataset_field_role: { tenantId: tenant.id, dataset, field: g.field, role: g.role as any } },
          create: { tenantId: tenant.id, dataset, field: g.field, role: g.role as any, canView: g.canView, canEdit: g.canEdit },
          update: { canView: g.canView, canEdit: g.canEdit },
        });
      }
      if (removed.length) {
        await tx.datasetFieldAccess.deleteMany({ where: { id: { in: removed.map((g) => g.id) } } });
      }
      // Who may see what is itself worth a record.
      await tx.auditEvent.create({
        data: {
          tenantId: tenant.id,
          category: 'DATA_EDIT',
          action: `dataset.${dataset}.access-matrix.import`,
          actorEmail: process.env.USER ? `script:${process.env.USER}` : 'script',
          targetType: `dataset:${dataset}`,
          metadata: {
            file: values.csv!.split('/').pop(),
            roles: roles.map((r) => r.role),
            added: added.length, changed: changed.length, removed: removed.length,
          },
        },
      });
    }, { timeout: 60_000 });
    console.log('\nWritten.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
