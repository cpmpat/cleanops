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
//   --list <key>        which list: user (default), accommodation, owner, oxpoint
//   --apply             write (default: report only)
//   --show-keys         print every natural key the sheet yielded
//   --overwrite-app-edits  allow --apply when the sheet differs from a value
//                       last edited in the app; the sheet's value wins. Without
//                       it the apply stops and lists those cells.
//   --metadata-only     reload labels, descriptions and column order from the
//                       mapping<Tab> sheet into dataset_fields and stop. No
//                       data row is read into the table or written, so it is
//                       safe on a list people already edit in the app.
//                       Mapping rows for columns the table does not have are
//                       skipped, never created.
//
// CHANGE HISTORY
//   Every cell an apply changes is recorded in dataset_field_changes (one
//   audit event per run, actor "sheet import", role IMPORT), and every new row
//   as a change of its key column. That is what Notifications → Data shows for
//   edits made in the sheet. Sensitive columns are recorded as changed, without
//   values. The dry run prints the same diff — counts, keys and field names,
//   never values.
//
// Exit codes:
//   0  success            1  one or more rows failed            2  bad usage

import { parseArgs } from 'node:util';
import { Prisma } from '@prisma/client';
import { bootScriptContext, resolveTenant } from './lib/script-context';
import { GoogleSheetsClient } from '../src/datasets/google-sheets.client';
import { squash } from '../src/datasets/datasets.service';

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
    'overwrite-app-edits': { type: 'boolean', default: false },
    'metadata-only': { type: 'boolean', default: false },
  },
});

/**
 * Which columns are pick lists (dataset_picklist_values.list). Set on import
 * so a re-import cannot drop the binding; values live in the database.
 */
const PICKLIST_BINDINGS: Record<string, Record<string, string>> = {
  accommodation: {
    source: 'accommodation.source',
    status: 'accommodation.status',
    accommodationStandard: 'accommodation.accommodationStandard',
    checkInMethod: 'accommodation.checkInMethod',
    terraceType: 'accommodation.terraceType',
  },
};

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
  /**
   * The list may have no mapping<Tab>. Then the data tab's header row is the
   * metadata: column order from its position, labels = the header names.
   */
  mappingOptional?: boolean;
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
    tab: 'Accommodation',
    mappingTab: 'mappingAccommodation',
    model: 'cdmAccommodation',
    key: 'idAvantio',
    // Only the columns that are not text. Every type here is evidence from the
    // real export, never a guess from the name.
    //
    // Four columns came back from the dry runs as numbers that are not.
    // `feeExtraPerson` is a fee or FALSE meaning none (77 rows), `costChekin`
    // the same (11); `feePms` and `floor` carry manual markers like "x" and
    // "200%". Text costs nothing in the viewer — its sort already compares
    // numerically whenever both values happen to be numbers, whatever the
    // declared type.
    //
    // `feeAdmin` is NOT one of them, despite one cell that held "x". That was
    // a typo in the sheet, corrected at source, and the column really is a
    // number — which is worth more than the column being permissive.
    types: {
      feeFinalCleaningVatIncl: 'int',
      maximumRelease: 'int',
      sizeM2: 'int',
      bedrooms: 'int',
      feeAdmin: 'int',
      feeBording: 'int',
      feeChannelManager: 'int',
      mlos: 'int',
      countOccuranceOfcityTaxEntityRegistredEntity: 'int',
      parkingNumber: 'int',
      bathrooms: 'float',
      costAvantio: 'decimal',
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
      dateContractTermination: 'date',
      totalBedrooms: 'int',
      otaHousingAnywhere: 'bool',
      totalBathrooms: 'float',
      // 6 Oct 2026: tag columns for marking rows, and a link.
      markField1: 'bool',
      markField2: 'bool',
      markField3: 'bool',
      markField4: 'bool',
      markField5: 'bool',
      checkInInstructionLink: 'url',
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
      ['tech',        /^(routerModel|intercom|bellLabel|vitejEspId|vitejBoxGateUrl|tvModel|buildingUnderConstruction|propertyFactWifi)/],
      ['ops',         /^(supplierFinalCleaning|finalCleaningProvided|checkIn|chekin|rajonUserId|hostsName|contactBuildingManagement|notes|keysQuantity)/],
      ['location',    /^(address|city|unit|floor|parkingNumber|parking|parkingType|parkingLimits)$/],
      ['identity',    /^(source|status|id|idBh|idAvantio|titleAvantio|nickname)$/],
      ['property',    /.*/],
    ],
    // 19 of the 164 columns are Drive folders, Canva designs, listing pages or
    // spreadsheets. As text they each eat 190px of a table that is already
    // 164 columns wide; as an icon they cost 72.
    urlMatch: [/^url/i, /Url$/, /^link/i, /^airbnbUrl/],
  },

  owner: {
    tab: 'Owner',
    mappingTab: 'mappingOwner',
    model: 'cdmOwner',
    key: 'id',
    types: { vatPayer: 'bool' },
    // Bank account and birth number: recorded in history without values,
    // and that history is ADMIN's alone.
    sensitive: ['iban', 'birthNumber'],
    hidden: [],
    required: ['id'],
  },

  oxpoint: {
    tab: 'OX Point',
    mappingTab: 'mappingOXPoint',
    mappingOptional: true,
    model: 'cdmOxPoint',
    key: 'id',
    types: {},
    // Codes that open a box. Recorded in history without values.
    sensitive: ['accessCode', 'lockboxCode'],
    hidden: [],
    required: ['id'],
  },
};

/**
 * Find a tab by name, tolerating how it is actually spelled.
 *
 * This is the third round trip lost to a tab name. `Accomodation` became
 * `Accommodation`; before that the data tab and its mapping tab disagreed on
 * how many m's the word has. An exact match is tried first — if the name is
 * right, nothing clever happens — and only then the squashed comparison the
 * viewer already uses.
 *
 * When nothing matches, the error names every tab the spreadsheet has. "Check
 * the tab exists" is not useful advice when the reason it does not exist is a
 * spelling you cannot see.
 */
async function resolveTab(
  sheets: GoogleSheetsClient,
  spreadsheetId: string,
  wanted: string,
): Promise<string> {
  const tabs = await sheets.listTabs(spreadsheetId);
  const exact = tabs.find((t) => t === wanted);
  if (exact) return exact;

  const near = tabs.find((t) => squash(t) === squash(wanted));
  if (near) {
    console.log(`  note: no tab called "${wanted}"; using "${near}"`);
    return near;
  }

  throw new Error(
    `No tab matching "${wanted}". The spreadsheet has: ${tabs.join(', ') || '(none)'}`,
  );
}

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

/** A 1-based index to column letters (1 → A, 28 → AB). */
function indexToLetter(n: number): string {
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
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
  // All the ways this spreadsheet says "nothing here".
  //
  // "?" and "/" are typed by people. "string" is placeholder text sitting in
  // nine columns, and importing it would make it look like a credential.
  // "null" is 34 cells of a formula that returned the word. The #-prefixed
  // ones are Excel's own error values — a broken VLOOKUP is an absence, and
  // storing "#N/A" as if it were a value spreads the breakage into the
  // database.
  const EMPTY = ['', '?', '/', 'string', 'null', 'undefined',
                 '#N/A', 'N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!'];
  return EMPTY.includes(t) ? null : t;
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

/** Who a sheet reload is, in dataset_field_changes and audit_events. */
const IMPORT_ACTOR = 'sheet import';
const IMPORT_ROLE = 'IMPORT';

/**
 * A stored value as the change history writes it — the same rendering the
 * app's own saves use (datasets.service render()), so the two read alike.
 */
function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Equal as the viewer would show them; numbers compare as numbers (12.50 = 12.5). */
function sameValue(a: unknown, b: unknown): boolean {
  const x = renderValue(a);
  const y = renderValue(b);
  if (x === y) return true;
  if (x !== '' && y !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    return Number(x) === Number(y);
  }
  return false;
}

type ListSpec = (typeof LISTS)[string];
type MappedField = {
  columnOrder: number;
  source: string;
  field: string;
  description: string | null;
  displayName: string | null;
};
type ScriptPrisma = Awaited<ReturnType<typeof bootScriptContext>>['prisma'];

/** How a list's spec classifies one column. Shared by the full and metadata-only paths. */
function specHelpers(spec: ListSpec) {
  return {
    groupOf: (name: string): string | null =>
      spec.groups?.find(([, re]) => re.test(name))?.[0] ?? null,
    isSensitive: (name: string): boolean =>
      spec.sensitive.includes(name) ||
      (spec.sensitiveMatch ?? []).some((re) => re.test(name)),
    typeOf: (name: string): string =>
      spec.types[name] ??
      ((spec.urlMatch ?? []).some((re) => re.test(name)) ? 'url' : 'text'),
  };
}

/**
 * --metadata-only: bring dataset_fields' labels, descriptions and column order
 * in line with the mapping tab, and nothing else.
 *
 * Updates touch only those three things — type, sensitivity, pick-list binding
 * and visibility stay exactly as the database has them, because some of those
 * were set by migrations and by hand. A column the table has but
 * dataset_fields does not yet describe is created with the same defaults the
 * full import would give it.
 */
async function writeMetadataOnly(
  prisma: ScriptPrisma,
  tenantId: string,
  spec: ListSpec,
  fields: MappedField[],
) {
  const list = values.list!;
  const { groupOf, isSensitive, typeOf } = specHelpers(spec);
  const current = new Map(
    (await prisma.datasetField.findMany({
      where: { tenantId, dataset: list },
      select: { field: true, displayName: true, description: true, columnOrder: true },
    })).map((f: { field: string; displayName: string | null; description: string | null; columnOrder: number }) => [f.field, f]),
  );

  const created: MappedField[] = [];
  const changed: Array<{ f: MappedField; what: string[] }> = [];
  for (const f of fields) {
    const label = f.displayName ?? f.source;
    const b = current.get(f.field);
    if (!b) { created.push(f); continue; }
    const what: string[] = [];
    if ((b.displayName ?? '') !== label) what.push(`label "${b.displayName ?? ''}" → "${label}"`);
    if ((b.description ?? '') !== (f.description ?? '')) what.push('description');
    if (b.columnOrder !== f.columnOrder) what.push(`order ${b.columnOrder} → ${f.columnOrder}`);
    if (what.length) changed.push({ f, what });
  }
  const mapped = new Set(fields.map((f) => f.field));
  const notInMapping = [...current.keys()].filter((k) => !mapped.has(k));

  console.log(`\nMetadata: ${changed.length} changed, ${created.length} new, ${fields.length - changed.length - created.length} unchanged`);
  for (const { f, what } of changed.slice(0, 60)) console.log(`  ~ ${f.field}: ${what.join(', ')}`);
  if (changed.length > 60) console.log(`  … +${changed.length - 60} more`);
  for (const f of created) console.log(`  + ${f.field} ("${f.displayName ?? f.source}")`);
  if (notInMapping.length) {
    console.log(`\n${notInMapping.length} column(s) described in the app but not in the mapping tab — left as they are:`);
    console.log(`  ${notInMapping.join(', ')}`);
  }

  if (!values.apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply.');
    return;
  }

  await prisma.$transaction(async (tx: any) => {
    for (const { f } of changed) {
      await tx.datasetField.update({
        where: { tenantId_dataset_field: { tenantId, dataset: list, field: f.field } },
        data: { displayName: f.displayName ?? f.source, description: f.description, columnOrder: f.columnOrder },
      });
    }
    for (const f of created) {
      await tx.datasetField.create({
        data: {
          tenantId,
          dataset: list,
          columnOrder: f.columnOrder,
          field: f.field,
          displayName: f.displayName ?? f.source,
          description: f.description,
          type: typeOf(f.field),
          hiddenByDefault: spec.hidden.includes(f.field),
          sensitive: isSensitive(f.field),
          required: spec.required.includes(f.field),
          group: groupOf(f.field),
          picklist: PICKLIST_BINDINGS[list]?.[f.field] ?? null,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        tenantId,
        category: 'DATA_EDIT',
        action: `dataset.${list}.metadata.reload`,
        actorEmail: process.env.USER ? `script:${process.env.USER}` : 'script',
        targetType: `dataset:${list}`,
        metadata: { changed: changed.length, created: created.length },
      },
    });
  }, { timeout: 60_000 });
  console.log('\nWritten. Open the list and press Refresh to see the new labels.');
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
    console.log(`List   : ${values.list}`);
    const metadataOnly = values['metadata-only'];
    console.log(`Mode   : ${values.apply ? 'APPLY' : 'DRY RUN'}${metadataOnly ? ' — metadata only' : ''}\n`);

    // App edits are protected further down, cell by cell: the apply stops only
    // when the sheet would actually overwrite a value last edited in the app.

    // Resolve both tab names up front, so a rename fails here with the list of
    // real tabs rather than three steps later as a parse error.
    const dataTab = await resolveTab(sheets, row.datasetsSheetId, spec.tab);
    let mappingTab: string | null = null;
    try {
      mappingTab = await resolveTab(sheets, row.datasetsSheetId, spec.mappingTab);
    } catch (e) {
      if (!spec.mappingOptional) throw e;
      console.log(`No ${spec.mappingTab} tab — the data tab's header row names the columns.`);
    }
    console.log(`Tabs   : ${dataTab}${mappingTab ? ` + ${mappingTab}` : ''}\n`);

    // ── data ───────────────────────────────────────────────────────────────
    // Read first: without a mapping tab, its header row is the metadata.
    const { columns, rows } = await sheets.readTab(row.datasetsSheetId, dataTab);

    // ── metadata ───────────────────────────────────────────────────────────
    const mapRows: string[][] = mappingTab
      ? ((await sheets.readValues(row.datasetsSheetId, mappingTab)) ?? [])
      // Same shape as a mapping tab — [letter, source, description, label] —
      // so everything below stays one code path. Row 1 is skipped as a header.
      : [[], ...columns.map((c, i) => [indexToLetter(i + 1), c ?? '', '', ''])];
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

    console.log(`Data    : ${rows.length} row(s) x ${columns.length} column(s)`);

    const known = new Set(fields.map((f) => f.source));
    const unmapped = columns.filter((c) => c && !known.has(c));
    if (unmapped.length) {
      console.log(`\n  ${unmapped.length} column(s) in the data with no mapping row, ignored:`);
      console.log(`  ${unmapped.join(', ')}`);
    }

    // ── repeated column names ──────────────────────────────────────────────
    //
    // A spreadsheet can have two columns called the same thing; a table cannot.
    // The importer writes `data[field] = value` as it walks the row, so a
    // repeat does not fail — the second one silently overwrites the first, and
    // one real column is quietly gone.
    //
    // This is the bug the Accommodation list started with: `status` appeared
    // twice, meaning Valid/Invalid in one place and Listed in the other, and
    // the sheet-era viewer papered over it well enough that nobody noticed.
    const dupCol = (names: string[]) => {
      const seen = new Map<string, number>();
      for (const n of names) if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
      return [...seen.entries()].filter(([, n]) => n > 1);
    };

    const dataDupes = dupCol(columns);
    const fieldDupes = dupCol(fields.map((f) => f.field));

    if (dataDupes.length > 0 || fieldDupes.length > 0) {
      console.log('\nRepeated column name(s) — a table cannot hold two of these:');
      for (const [n, c] of dataDupes) console.log(`  data tab     ${n} x${c}`);
      for (const [n, c] of fieldDupes) console.log(`  mapping tab  ${n} x${c}`);
      console.log('  Rename one of each pair in the sheet. Left alone, the last');
      console.log('  occurrence silently overwrites the earlier one on import.');
      if (values.apply) {
        console.error('\nRefusing to apply: one column would be lost without saying so.');
        process.exit(1);
      }
    }

    // ── does the table actually have these columns? ────────────────────────
    //
    // The mapping tab and the Prisma model are two lists of column names
    // maintained in different places, and they drift. The first Accommodation
    // dry run described 165 columns against a table built with 164 — a gap
    // that says nothing at all on a dry run and then throws "Unknown argument"
    // on the first row of the apply.
    //
    // Read the model's real field list rather than a copy of it: the DMMF is
    // generated from the schema, so this cannot go stale the way a hardcoded
    // list would.
    const modelName = spec.model.charAt(0).toUpperCase() + spec.model.slice(1);
    const modelFields = new Set(
      Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)?.fields.map((f) => f.name) ?? [],
    );
    const notInTable = fields.filter((f) => !modelFields.has(f.field));

    if (notInTable.length > 0) {
      console.log(`\n${notInTable.length} mapped column(s) have no matching column on ${modelName}:`);
      for (const f of notInTable) {
        console.log(`  ${f.source}${f.source === f.field ? '' : ` -> ${f.field}`}`);
      }
      console.log('  Either the mapping tab describes a column the data tab does not have,');
      console.log('  or the table needs a migration to add it.');
      if (metadataOnly) {
        console.log('  Metadata only: these rows are skipped. A dataset_fields row for a');
        console.log('  column the table lacks would break the list for everyone.');
      } else if (values.apply) {
        console.error('\nRefusing to apply: every row would fail on the first unknown column.');
        process.exit(1);
      }
    }

    if (metadataOnly) {
      await writeMetadataOnly(prisma, tenant.id, spec, fields.filter((f) => modelFields.has(f.field)));
      return;
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

    // ── what would change ──────────────────────────────────────────────────
    //
    // Every cell is coerced once, here, and compared with what the table
    // holds. The one comparison drives the dry-run report, the app-edit guard
    // and the change history the apply writes.
    const delegate = (prisma as any)[spec.model];
    const pk = Prisma.dmmf.datamodel.models
      .find((m) => m.name === modelName)!.fields.find((f) => f.isId)!.name;

    const planned: Array<{ key: string; data: Record<string, unknown> }> = [];
    let skipped = 0;
    for (const r of rows) {
      const key = clean(r[keyIndex]);
      if (!key) { skipped++; continue; }
      const data: Record<string, unknown> = {};
      for (const f of fields) {
        const i = columns.indexOf(f.source);
        if (i < 0 || !modelFields.has(f.field)) continue;
        data[f.field] = coerce(f.field, clean(r[i]), spec.types[f.field] ?? 'text');
      }
      delete data[spec.key];
      planned.push({ key, data });
    }

    const existingRows: Array<Record<string, unknown>> = await delegate.findMany({
      where: { tenantId: tenant.id },
    });
    const existing = new Map(existingRows.map((e) => [String(e[spec.key]), e]));

    type Cell = { rowId: string; key: string; field: string; old: unknown; new: unknown };
    const cells: Cell[] = [];
    const addedKeys: string[] = [];
    for (const p of planned) {
      const e = existing.get(p.key);
      if (!e) { addedKeys.push(p.key); continue; }
      for (const [field, v] of Object.entries(p.data)) {
        if (!sameValue(e[field], v)) {
          cells.push({ rowId: String(e[pk]), key: p.key, field, old: e[field], new: v });
        }
      }
    }
    const changedKeys = new Set(cells.map((c) => c.key));
    const inSheet = new Set(planned.map((p) => p.key));
    const goneFromSheet = [...existing.keys()].filter((k) => !inSheet.has(k));

    // A cell whose most recent change was made in the app, not by an import.
    const history = await prisma.datasetFieldChange.findMany({
      where: { tenantId: tenant.id, dataset: values.list! },
      orderBy: { createdAt: 'asc' },
      select: { rowId: true, field: true, actorRole: true },
    });
    const lastActor = new Map<string, string | null>();
    for (const h of history) lastActor.set(`${h.rowId}:${h.field}`, h.actorRole);
    const conflicts = cells.filter((c) => {
      const a = lastActor.get(`${c.rowId}:${c.field}`);
      return a !== undefined && a !== IMPORT_ROLE;
    });

    console.log(
      `\nRows   : ${planned.length} in the sheet (+${skipped} with no ${spec.key}, skipped) — ` +
      `${addedKeys.length} new, ${changedKeys.size} changed, ` +
      `${planned.length - addedKeys.length - changedKeys.size} unchanged`,
    );
    console.log(`Cells  : ${cells.length} would change`);
    if (cells.length) {
      const byField = new Map<string, number>();
      for (const c of cells) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
      const top = [...byField].sort((a, b) => b[1] - a[1]);
      console.log('  by column: ' + top.slice(0, 30).map(([f, n]) => `${f}×${n}`).join('  ') +
        (top.length > 30 ? `  … +${top.length - 30} more` : ''));
    }
    if (addedKeys.length) {
      console.log(`  new ${spec.key}: ${addedKeys.slice(0, 40).join(' ')}${addedKeys.length > 40 ? ` … +${addedKeys.length - 40}` : ''}`);
    }
    if (goneFromSheet.length) {
      console.log(`\n${goneFromSheet.length} row(s) in the table are no longer in the sheet — left as they are:`);
      console.log(`  ${goneFromSheet.slice(0, 40).join(' ')}${goneFromSheet.length > 40 ? ' …' : ''}`);
    }
    if (conflicts.length) {
      console.log(`\n${conflicts.length} cell(s) were last edited in the app and the sheet says something else:`);
      for (const c of conflicts.slice(0, 40)) console.log(`  ${c.key.padEnd(14)} ${c.field}`);
      if (conflicts.length > 40) console.log(`  … +${conflicts.length - 40} more`);
      console.log('  The apply stops on these unless you pass --overwrite-app-edits (the sheet wins).');
    }

    if (unparseable.size > 0) {
      console.log(`\n${unparseable.size} column(s) hold values their declared type cannot take:`);
      for (const [field, e] of [...unparseable].sort((a, b) => b[1].count - a[1].count)) {
        console.log(`  ${field.padEnd(46)} ${String(e.count).padStart(4)}x  e.g. ${e.sample.join(' | ')}`);
      }
      console.log('  Those cells import as NULL.');
    }

    if (!values.apply) {
      console.log(`\nWould write ${fields.length} metadata row(s), ${addedKeys.length} new and ${changedKeys.size} changed row(s).`);
      console.log('\nDry run. Nothing written. Re-run with --apply.');
      return;
    }

    if (conflicts.length && !values['overwrite-app-edits']) {
      console.error('\nRefusing to apply: the sheet would overwrite values edited in the app (listed above).');
      console.error('Fix them in the sheet, or re-run with --overwrite-app-edits to let the sheet win.');
      process.exit(2);
    }

    // ── write ──────────────────────────────────────────────────────────────
    const { groupOf, isSensitive, typeOf } = specHelpers(spec);

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
          picklist: PICKLIST_BINDINGS[values.list!]?.[f.field] ?? null,
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
          // Set when configured; otherwise left as the database has it.
          picklist: PICKLIST_BINDINGS[values.list!]?.[f.field] ?? undefined,
        },
      });
    }
    console.log(`\nMetadata written: ${fields.length} column(s).`);

    // ── data ───────────────────────────────────────────────────────────────
    // Only rows that are new or differ are written.
    let written = 0;
    const failedKeys = new Set<string>();
    const added: Array<{ rowId: string; key: string }> = [];
    for (const p of planned) {
      const isNew = !existing.has(p.key);
      if (!isNew && !changedKeys.has(p.key)) continue;
      try {
        const saved = await delegate.upsert({
          where: { [`tenantId_${spec.key}`]: { tenantId: tenant.id, [spec.key]: p.key } },
          create: { tenantId: tenant.id, [spec.key]: p.key, ...p.data },
          update: p.data,
        });
        if (isNew) added.push({ rowId: String(saved[pk]), key: p.key });
        written++;
      } catch (err) {
        failures++;
        failedKeys.add(p.key);
        console.error(`  ${p.key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── change history ─────────────────────────────────────────────────────
    // Not on the very first load of a list: "every row was added" is not news.
    const firstLoad = existing.size === 0;
    const recorded = cells.filter((c) => !failedKeys.has(c.key));
    if (firstLoad) console.log('History: first load of this list — not recorded as changes.');
    if (!firstLoad && (recorded.length || added.length)) {
      const sensitive = new Set(
        (await prisma.datasetField.findMany({
          where: { tenantId: tenant.id, dataset: values.list!, sensitive: true },
          select: { field: true },
        })).map((f: { field: string }) => f.field),
      );
      const event = await prisma.auditEvent.create({
        data: {
          tenantId: tenant.id,
          category: 'DATA_EDIT',
          action: `dataset.${values.list}.import`,
          actorEmail: IMPORT_ACTOR,
          targetType: `dataset:${values.list}`,
          metadata: {
            added: added.length,
            changedRows: changedKeys.size,
            cells: recorded.length,
            overwroteAppEdits: conflicts.length,
            by: process.env.USER ?? null,
          },
        },
      });
      const base = {
        tenantId: tenant.id, eventId: event.id, dataset: values.list!,
        actorEmail: IMPORT_ACTOR, actorRole: IMPORT_ROLE,
      };
      const changeRows = [
        ...recorded.map((c) => {
          const masked = sensitive.has(c.field);
          return {
            ...base, rowId: c.rowId, field: c.field, masked,
            oldValue: masked ? null : renderValue(c.old) || null,
            newValue: masked ? null : renderValue(c.new) || null,
          };
        }),
        // A new row is one change of its key column, from nothing.
        ...added.map((a) => ({
          ...base, rowId: a.rowId, field: spec.key, masked: false, oldValue: null, newValue: a.key,
        })),
      ];
      for (let i = 0; i < changeRows.length; i += 1000) {
        await prisma.datasetFieldChange.createMany({ data: changeRows.slice(i, i + 1000) });
      }
      console.log(`History: ${changeRows.length} change(s) recorded (Notifications → Data).`);
    }

    console.log(`Data written: ${written} row(s) (${added.length} new). Unchanged: ${planned.length - written - failedKeys.size}. Skipped (no ${spec.key}): ${skipped}. Failed: ${failures}.`);

  } finally {
    await ctx.close();
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
