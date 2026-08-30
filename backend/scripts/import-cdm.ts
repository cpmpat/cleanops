// backend/scripts/import-cdm.ts
//
// Move one CDM list out of the Google Sheet and into Postgres.
//
// WHY IT READS THE SHEET AND NOT A CSV
//   The User list carries plaintext mailbox passwords and, in the columns that
//   are empty today, birth numbers and addresses. Exporting it to a file to
//   feed an importer would put all of that on somebody's disk and one careless
//   `git add` away from being permanent. The app already has read-only access
//   to the sheet through the service account, so the data goes straight from
//   Google into Neon and never exists as a file.
//
// WHAT IT WRITES
//   dataset_fields  one row per column, from the mapping<Tab> sheet
//   cdm_users       one row per person, keyed on internalId
//
// Both are upserts, so re-running is safe and is the intended way to pick up
// changes while the sheet is still the source of truth.
//
// DRY RUN IS THE DEFAULT. Nothing is written unless you pass --apply.
//
// Usage:
//   npm run import:cdm -- --tenant prague-stays
//   npm run import:cdm -- --tenant prague-stays --apply
//
// Options:
//   --tenant <id|slug>  required
//   --list <key>        which list (default: user; only `user` exists so far)
//   --apply             write (default: report only)
//
// Exit codes:
//   0  success            1  one or more rows failed            2  bad usage

import { parseArgs } from 'node:util';
import { bootScriptContext, resolveTenant } from './lib/script-context';
import { GoogleSheetsClient } from '../src/datasets/google-sheets.client';

// pnpm passes `--` through to the script, and parseArgs would reject it as an
// unexpected positional. Every script in here strips it the same way.
const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values } = parseArgs({
  args: argv,
  options: {
    tenant: { type: 'string' },
    list: { type: 'string', default: 'user' },
    apply: { type: 'boolean', default: false },
  },
});

if (!values.tenant) {
  console.error('Usage: npm run import:cdm -- --tenant <id|slug> [--list user] [--apply]');
  process.exit(2);
}

/**
 * How each list maps from the sheet.
 *
 * `type` is what the column becomes in Postgres and how the create form parses
 * it back. `sensitive` is permission — credentials and personal data — and is
 * deliberately a different flag from `hiddenByDefault`, which is only tidiness.
 */
const LISTS: Record<string, {
  tab: string;
  mappingTab: string;
  model: string;
  key: string;
  types: Record<string, 'int' | 'bool' | 'date'>;
  sensitive: string[];
  hidden: string[];
  required: string[];
}> = {
  user: {
    tab: 'User',
    mappingTab: 'mappingUser',
    model: 'cdmUser',
    key: 'internalId',
    types: {
      dataAccess: 'int',
      checkinCollaborator: 'bool',
      terminationDate: 'date',
      startDate: 'date',
    },
    // Mailbox passwords, and the personal data the empty columns are for.
    sensitive: [
      'passwordEmail1', 'passwordEmail2Avantio',
      'birthNumber', 'birthPlace', 'address', 'healthInsurer', 'tariff',
    ],
    hidden: ['rajon', 'nickname', 'cleaningArea', 'folder'],
    required: ['internalId'],
  },
};

/** Column letters (A, B, … AA, AB) to a 1-based index. */
function letterToIndex(letter: string): number {
  return letter
    .trim()
    .toUpperCase()
    .split('')
    .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
}

/**
 * Phone numbers in the sheet carry stray spaces and, on a few rows, an
 * invisible U+202A directional mark left behind by a paste. Stored as-is they
 * compare unequal to the same number typed by hand, which is the kind of bug
 * nobody ever finds.
 */
function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.replace(/[​-‏‪-‮﻿]/g, '').trim();
  // A literal "?" is how the sheet spells "we do not know", not a value.
  return t === '' || t === '?' || t === '/' ? null : t;
}

function coerce(raw: string | null, type: 'text' | 'int' | 'bool' | 'date'): unknown {
  if (raw === null) return null;
  if (type === 'int') {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (type === 'bool') {
    const t = raw.toUpperCase();
    if (t === 'TRUE' || t === 'YES' || t === '1') return true;
    if (t === 'FALSE' || t === 'NO' || t === '0') return false;
    return null;
  }
  if (type === 'date') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return raw;
}

async function main() {
  const ctx = await bootScriptContext();
  const { prisma } = ctx;
  let failures = 0;

  try {
    const spec = LISTS[values.list!];
    if (!spec) {
      console.error(`Unknown list "${values.list}". Known: ${Object.keys(LISTS).join(', ')}`);
      process.exit(2);
    }

    const tenant = await resolveTenant(prisma, values.tenant!);
    const row = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { datasetsSheetId: true },
    });
    if (!row?.datasetsSheetId) {
      console.error('This tenant has no datasetsSheetId. Set it in Settings first.');
      process.exit(2);
    }

    const sheets = new GoogleSheetsClient();
    console.log(`Tenant : ${tenant.name} (${tenant.slug})`);
    console.log(`List   : ${values.list}  (${spec.tab} + ${spec.mappingTab})`);
    console.log(`Mode   : ${values.apply ? 'APPLY' : 'DRY RUN'}\n`);

    // ── metadata ───────────────────────────────────────────────────────────
    const mapRows = (await sheets.readValues(row.datasetsSheetId, spec.mappingTab)) ?? [];
    const fields = mapRows
      .slice(1) // row 1 is the mapping sheet's own header
      .map((r) => ({
        columnOrder: letterToIndex(r[0] ?? ''),
        field: clean(r[1]),
        description: clean(r[2]),
        displayName: clean(r[3]),
      }))
      .filter((f): f is { columnOrder: number; field: string; description: string | null; displayName: string | null } =>
        Boolean(f.field) && f.columnOrder > 0);

    console.log(`Metadata: ${fields.length} column(s) described`);

    // ── data ───────────────────────────────────────────────────────────────
    const { columns, rows } = await sheets.readTab(row.datasetsSheetId, spec.tab);
    console.log(`Data    : ${rows.length} row(s) x ${columns.length} column(s)`);

    const known = new Set(fields.map((f) => f.field));
    const unmapped = columns.filter((c) => c && !known.has(c));
    if (unmapped.length) {
      console.log(`\n  ${unmapped.length} column(s) in the data with no mapping row, ignored:`);
      console.log(`  ${unmapped.join(', ')}`);
    }

    const keyIndex = columns.indexOf(spec.key);
    if (keyIndex < 0) {
      console.error(`\nThe data tab has no "${spec.key}" column. Cannot key the import.`);
      process.exit(2);
    }

    // Duplicate keys would silently collapse rows in an upsert, so say so first.
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = clean(r[keyIndex]);
      if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    if (dupes.length) {
      console.error(`\nDuplicate ${spec.key} values — refusing to import:`);
      for (const [k, n] of dupes) console.error(`  ${k} x${n}`);
      process.exit(1);
    }

    if (!values.apply) {
      const withKey = rows.filter((r) => clean(r[keyIndex])).length;
      console.log(`\nWould write ${fields.length} metadata row(s) and ${withKey} data row(s).`);
      console.log(`Skipping ${rows.length - withKey} row(s) with no ${spec.key}.`);
      console.log('\nDry run. Nothing written. Re-run with --apply.');
      return;
    }

    // ── write ──────────────────────────────────────────────────────────────
    for (const f of fields) {
      const type = spec.types[f.field] ?? 'text';
      await prisma.datasetField.upsert({
        where: { tenantId_dataset_field: { tenantId: tenant.id, dataset: values.list!, field: f.field } },
        create: {
          tenantId: tenant.id,
          dataset: values.list!,
          columnOrder: f.columnOrder,
          field: f.field,
          displayName: f.displayName ?? f.field,
          description: f.description,
          type,
          hiddenByDefault: spec.hidden.includes(f.field),
          sensitive: spec.sensitive.includes(f.field),
          required: spec.required.includes(f.field),
        },
        update: {
          columnOrder: f.columnOrder,
          displayName: f.displayName ?? f.field,
          description: f.description,
          type,
          hiddenByDefault: spec.hidden.includes(f.field),
          sensitive: spec.sensitive.includes(f.field),
          required: spec.required.includes(f.field),
        },
      });
    }
    console.log(`\nMetadata written: ${fields.length} column(s).`);

    const delegate = (prisma as any)[spec.model];
    let written = 0;
    let skipped = 0;

    for (const r of rows) {
      const key = clean(r[keyIndex]);
      if (!key) { skipped++; continue; }

      const data: Record<string, unknown> = {};
      for (const f of fields) {
        const i = columns.indexOf(f.field);
        if (i < 0) continue;
        data[f.field] = coerce(clean(r[i]), spec.types[f.field] ?? 'text');
      }
      delete data[spec.key];

      try {
        await delegate.upsert({
          where: { [`tenantId_${spec.key}`]: { tenantId: tenant.id, [spec.key]: key } },
          create: { tenantId: tenant.id, [spec.key]: key, ...data },
          update: data,
        });
        written++;
      } catch (err) {
        failures++;
        console.error(`  ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`Data written: ${written} row(s). Skipped (no ${spec.key}): ${skipped}. Failed: ${failures}.`);
  } finally {
    await ctx.close();
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
