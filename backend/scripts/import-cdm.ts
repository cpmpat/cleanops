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
//   --show-keys         print every natural key the sheet yielded
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
    'show-keys': { type: 'boolean', default: false },
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
type FieldType = 'int' | 'float' | 'decimal' | 'bool' | 'date' | 'url';

const LISTS: Record<string, {
  tab: string;
  mappingTab: string;
  model: string;
  key: string;
  types: Record<string, FieldType>;
  sensitive: string[];
  /** Regexes, for lists too wide to name every credential column by hand. */
  sensitiveMatch?: RegExp[];
  hidden: string[];
  required: string[];
  /** Which visual family a column belongs to, first match wins. */
  groups?: Array<[string, RegExp]>;
  /**
   * Columns that hold a link. Stored as plain text — a URL is a string, and a
   * side table mapping a shortcut to a URL column would be a join to look up
   * what the cell already contains. The type exists so the viewer can render
   * the cell as an icon and give the column 72px instead of 190.
   */
  urlMatch?: RegExp[];
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

  accommodation: {
    tab: 'Accomodation',
    mappingTab: 'mappingAccommodation',
    model: 'cdmAccommodation',
    key: 'idAvantio',
    // Only the 41 columns that are not text. Every type here is evidence from
    // the export, never a guess from the name: `otaHousingAnywhere` reads like
    // a boolean and holds TRUE, FALSE and "TO BE", so it stays text.
    types: {
      feeFinalCleaningVatIncl: 'int',
      maximumRelease: 'int',
      sizeM2: 'int',
      bedrooms: 'int',
      floor: 'int',
      feePms: 'int',
      feeAdmin: 'int',
      feeBording: 'int',
      feeChannelManager: 'int',
      mlos: 'int',
      feeExtraPerson: 'int',
      countOccuranceOfcityTaxEntityRegistredEntity: 'int',
      parkingLotNumber: 'int',
      bathrooms: 'float',
      costAvantio: 'decimal',
      costChekin: 'decimal',
      otaBooking: 'bool',
      otaAirbnb: 'bool',
      elevator: 'bool',
      petsAllowed: 'bool',
      terrace: 'bool',
      balcony: 'bool',
      otaExpedia: 'bool',
      otaVrbo: 'bool',
      parking: 'bool',
      ownerVatPayer: 'bool',
      chekin: 'bool',
      cityTaxConsolidateReport: 'bool',
      finalCleaningProvided: 'bool',
      validFrom: 'date',
      validUntil: 'date',
      otaAirbnbSalesStarted: 'date',
      otaBookingSalesStarted: 'date',
      otaExpediaSaleStarted: 'date',
      otaHomeAwaySaleStarted: 'date',
      otaVrboSalesStarted: 'date',
      otaBookingSalesEnded: 'date',
      otaAirbnbSalesEnded: 'date',
      dateOffboard: 'date',
      contractSigned: 'date',
      contractTerminated: 'date',
    },
    sensitive: [],
    // Matched rather than listed. Channel passwords, Ubyport credentials and
    // lockbox codes are the reason this whole flag exists, and a list of 18
    // names is a bet that nobody adds a nineteenth.
    sensitiveMatch: [
      /password/i,
      /^email(Gmail|Airbnb|Booking|Expedia)$/,
      /^ubyport/i,
      /lockbox/i,
      /^codeLockBox$/,
      /^accountIdAirbnb$/,
      /^ownerAvantioPortalUser$/,
      /WifiName$/,
    ],
    hidden: [
      // Carried over from the sheet-backed view, which had these hardcoded.
      'idBh', 'feeFinalCleaningVatExl', 'feeFinalCleaningVatRate',
      'category', 'unit', 'listingDescriptionAirbnb',
      // Superseded by urlFolderUnit; kept only so nothing is lost.
      'urlFolderUnitOld',
    ],
    required: ['idAvantio'],
    // First match wins, so order matters: credentials before ota, because
    // `emailAirbnb` is a credential before it is a channel column.
    groups: [
      ['credentials', /^(password|email|ubyport|accountIdAirbnb|codeLockBox|lockboxCode|ownerAvantioPortalUser)|WifiPassword|WifiName/],
      ['citytax',     /^cityTax|countOccuranceOfcityTax|feeTransactionCityTax|urlFolderCityTax|urlSharedFolderCityTax|folderUnitPropertiesCityTax/],
      ['ota',         /^(ota|listing|link|roomIdBooking|propertyIdBooking|urlListingBooking|airbnbUrl|cancelationPolicy|stornoConditions|salesRentalDivision|apaPropertyId)/],
      ['pricing',     /^(fee|cost|pricing|petsFee|sumUp|invoicingProcess|additionalInvoicing|allowedSpendingForRepairs|maxWithoutSupplement)/],
      ['folders',     /^url|^folderUnitProperties/],
      ['contract',    /^(contract|cotractType|validFrom|validUntil|dateOffboard|ownerVatPayer|mlos|maximumRelease|maximumTimeRelease)/],
      ['tech',        /^(routerModel|intercom|bellLabel|espId|vitejBoxGateUrl|tvModel|buildingUnderConstruction|propertyFactWifi)/],
      ['ops',         /^(supplierFinalCleaning|finalCleaningProvided|checkIn|chekin|rajonUserId|hostsName|contactBuildingManagement|notes|keysQuantity)/],
      ['location',    /^(address|city|unit|floor|parkingLotNumber|parking|parkingType)$/],
      ['identity',    /^(source|status|id|idBh|idAvantio|titleAvantio|nickname)$/],
      ['property',    /.*/],
    ],
    // 19 of the 164 columns are Drive folders, Canva designs, listing pages or
    // spreadsheets. As text they each eat 190px of a table that is already
    // 164 columns wide; as an icon they cost 72.
    urlMatch: [/^url/i, /Url$/, /^link/i, /^airbnbUrl/],
  },
};

/**
 * A sheet column name as Postgres and Prisma can take it.
 *
 * Prisma field names must match [A-Za-z][A-Za-z0-9_]*, and the sheet has
 * `urlFolderPPPrevzetí`. A Czech company will keep producing names like it, so
 * this is a rule rather than a one-off rename: strip the diacritics, drop
 * anything still illegal, and the name stays recognisable
 * (`urlFolderPPPrevzeti`) instead of becoming `column_153`.
 *
 * The sheet's own spelling is never lost — it stays in `displayName`, and the
 * data tab is still matched on it, because that is what its header says.
 */
function dbName(sheetName: string): string {
  const ascii = sheetName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const safe = ascii.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z]/.test(safe) ? safe : `f${safe}`;
}

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
  // A literal "?" is how the sheet spells "we do not know", not a value. So is
  // a bare "string" — nine Accomodation columns are filled with that word, and
  // importing it would make placeholder text look like a credential.
  return t === '' || t === '?' || t === '/' || t === 'string' ? null : t;
}

/**
 * Values the declared type could not hold, counted per column.
 *
 * The first version returned null for these, which is the quiet version of
 * losing data: declare `feeExtraPerson` an integer, meet one row saying
 * "400 Kč", and the number is gone with nothing said. Now every one is counted
 * and the run reports them, so a wrong type is visible on the dry run rather
 * than discovered months later by its absence.
 */
const unparseable = new Map<string, { count: number; sample: string[] }>();

function note(field: string, raw: string) {
  const e = unparseable.get(field) ?? { count: 0, sample: [] };
  e.count++;
  if (e.sample.length < 3) e.sample.push(raw);
  unparseable.set(field, e);
}

function coerce(field: string, raw: string | null, type: 'text' | FieldType): unknown {
  if (raw === null) return null;
  if (type === 'int' || type === 'float' || type === 'decimal') {
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) { note(field, raw); return null; }
    return type === 'int' ? Math.trunc(n) : n;
  }
  if (type === 'bool') {
    const t = raw.toUpperCase();
    if (t === 'TRUE' || t === 'YES' || t === '1') return true;
    if (t === 'FALSE' || t === 'NO' || t === '0') return false;
    note(field, raw);
    return null;
  }
  if (type === 'date') {
    const d = new Date(raw);
    if (isNaN(d.getTime())) { note(field, raw); return null; }
    return d;
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
      .map((r) => {
        // `source` is the header text in the data tab; `field` is what the
        // column is called in Postgres. They differ only where the sheet uses
        // a character an identifier cannot.
        const source = clean(r[1]);
        return {
          columnOrder: letterToIndex(r[0] ?? ''),
          source,
          field: source ? dbName(source) : null,
          description: clean(r[2]),
          displayName: clean(r[3]),
        };
      })
      .filter((f): f is { columnOrder: number; source: string; field: string; description: string | null; displayName: string | null } =>
        Boolean(f.source) && Boolean(f.field) && f.columnOrder > 0);

    console.log(`Metadata: ${fields.length} column(s) described`);

    // ── data ───────────────────────────────────────────────────────────────
    const { columns, rows } = await sheets.readTab(row.datasetsSheetId, spec.tab);
    console.log(`Data    : ${rows.length} row(s) x ${columns.length} column(s)`);

    const known = new Set(fields.map((f) => f.source));
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

    if (values['show-keys']) {
      // Worth having on a first import. A row count that disagrees with what
      // you expect has two very different causes — the sheet grew, or
      // something below the table is being read as data — and the keys tell
      // them apart at a glance.
      const keys = rows.map((r) => clean(r[keyIndex])).filter(Boolean);
      console.log(`\n${keys.length} ${spec.key} value(s):`);
      for (let i = 0; i < keys.length; i += 12) {
        console.log('  ' + keys.slice(i, i + 12).join(' '));
      }
    }

    if (!values.apply) {
      // Walk every cell through the same coercion the write path uses. A dry
      // run that does not do this cannot tell you the types are wrong, which
      // is most of what a dry run is for.
      for (const r of rows) {
        if (!clean(r[keyIndex])) continue;
        for (const f of fields) {
          const i = columns.indexOf(f.source);
          if (i >= 0) coerce(f.field, clean(r[i]), spec.types[f.field] ?? 'text');
        }
      }
      if (unparseable.size > 0) {
        console.log(`\n${unparseable.size} column(s) hold values their declared type cannot take:`);
        for (const [field, e] of [...unparseable].sort((a, b) => b[1].count - a[1].count)) {
          console.log(`  ${field.padEnd(46)} ${String(e.count).padStart(4)}x  e.g. ${e.sample.join(' | ')}`);
        }
        console.log('  Those cells would import as NULL.');
      }

      const withKey = rows.filter((r) => clean(r[keyIndex])).length;
      console.log(`\nWould write ${fields.length} metadata row(s) and ${withKey} data row(s).`);
      console.log(`Skipping ${rows.length - withKey} row(s) with no ${spec.key}.`);
      console.log('\nDry run. Nothing written. Re-run with --apply.');
      return;
    }

    // ── write ──────────────────────────────────────────────────────────────
    const groupOf = (name: string): string | null =>
      spec.groups?.find(([, re]) => re.test(name))?.[0] ?? null;
    const isSensitive = (name: string): boolean =>
      spec.sensitive.includes(name) ||
      (spec.sensitiveMatch ?? []).some((re) => re.test(name));

    const typeOf = (name: string): string =>
      spec.types[name] ??
      ((spec.urlMatch ?? []).some((re) => re.test(name)) ? 'url' : 'text');

    for (const f of fields) {
      const type = typeOf(f.field);
      await prisma.datasetField.upsert({
        where: { tenantId_dataset_field: { tenantId: tenant.id, dataset: values.list!, field: f.field } },
        create: {
          tenantId: tenant.id,
          dataset: values.list!,
          columnOrder: f.columnOrder,
          field: f.field,
          displayName: f.displayName ?? f.source,
          description: f.description,
          type,
          hiddenByDefault: spec.hidden.includes(f.field),
          sensitive: isSensitive(f.field),
          required: spec.required.includes(f.field),
          group: groupOf(f.field),
        },
        update: {
          columnOrder: f.columnOrder,
          displayName: f.displayName ?? f.source,
          description: f.description,
          type,
          hiddenByDefault: spec.hidden.includes(f.field),
          // Only ever raised, never lowered. Un-marking a lockbox column has
          // to be a deliberate act in SQL, not a side effect of a re-import.
          sensitive: isSensitive(f.field) ? true : undefined,
          required: spec.required.includes(f.field),
          group: groupOf(f.field),
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
        const i = columns.indexOf(f.source);
        if (i < 0) continue;
        data[f.field] = coerce(f.field, clean(r[i]), spec.types[f.field] ?? 'text');
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

    if (unparseable.size > 0) {
      console.log(`\n${unparseable.size} column(s) held values their declared type could not take.`);
      console.log('Those cells are now NULL. Either the sheet needs cleaning or the type is wrong:');
      for (const [field, e] of [...unparseable].sort((a, b) => b[1].count - a[1].count)) {
        console.log(`  ${field.padEnd(46)} ${String(e.count).padStart(4)}x  e.g. ${e.sample.join(' | ')}`);
      }
    }
  } finally {
    await ctx.close();
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
