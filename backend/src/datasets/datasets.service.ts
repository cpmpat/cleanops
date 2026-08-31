import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GoogleSheetsClient } from './google-sheets.client';
import { toCsv, toXlsx } from './dataset-export';
import { UserRole } from '@prisma/client';

/**
 * The tabs this tenant's spreadsheet exposes.
 *
 * A registry rather than a database table, deliberately: there are three of
 * them, they are named by the sheet itself, and a table would be four files of
 * CRUD before anything is readable. When the second source lands — the one
 * that filters columns by role — this becomes a model, and `visibleColumns()`
 * below is the seam it plugs into.
 */
const TABS = [
  { key: 'accommodation', tab: 'Accomodation', label: 'Accommodation', source: 'db'    },
  { key: 'user',          tab: 'User',         label: 'User',          source: 'db'    },
  { key: 'owner',         tab: 'Owner',        label: 'Owner',         source: 'sheet' },
] as const;

/**
 * Which Prisma model backs a migrated list, and what its natural key is.
 *
 * The delegate is looked up by name rather than imported, which is what keeps
 * `read` and `create` generic across lists. The names here are the only place
 * that indirection is resolved, so a typo fails loudly at the first request
 * rather than silently returning nothing.
 */
const DB_MODELS: Record<string, { model: string; key: string; pk: string }> = {
  user:          { model: 'cdmUser',          key: 'internalId', pk: 'id'    },
  // The primary key is `rowId` here: the Accomodation sheet has its own column
  // called `id`, which would otherwise collide with Prisma's.
  accommodation: { model: 'cdmAccommodation', key: 'idAvantio',  pk: 'rowId' },
};

/**
 * Columns nobody wants in the default view. Still listed in the column picker,
 * so they are hidden rather than censored — anyone who needs one ticks it back.
 *
 * Sheet-backed lists only. A migrated list carries this per column in
 * `dataset_fields`, where it can be changed without a deploy — which is what
 * this array was always a stand-in for.
 */
const HIDDEN_BY_DEFAULT = [
  'idBh',
  'feeFinalCleaningVatExl',
  'feeFinalCleaningVatRate',
  'category',
  'unit',
  'listingDescriptionAirbnb',
];

/**
 * A tab's display metadata lives in a sibling tab named `mapping<Tab>` —
 * `mappingOwner` for `Owner`, and so on. Layout, from row 2 down:
 *
 *   column B  the column name as it appears in the data tab
 *   column C  a human description, shown on hover in the column picker
 *   column D  the label to display instead of the raw name
 *
 * Anything missing degrades quietly: no mapping tab means raw names, a blank
 * D means the raw name, a blank C means no tooltip. The alternative — failing
 * the whole dataset because a description is missing — would be absurd.
 */
const MAPPING_PREFIX = 'mapping';

/**
 * Tab names are typed by hand and drift: the data tab is `Accomodation` with
 * one m, its mapping tab `mappingAccommodation` with two. Comparing on a
 * squashed form — lowercased, non-alphanumerics dropped, repeated letters
 * collapsed — matches them without hard-coding either spelling.
 */
function squash(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(.)\1+/g, '$1');
}
const MAP_COL_SOURCE = 1;      // B
const MAP_COL_DESCRIPTION = 2; // C
const MAP_COL_LABEL = 3;       // D

export interface DatasetColumn {
  /** Name as it appears in the sheet's header row. The stable identity. */
  key: string;
  /** What to show the user — the mapped label, or the key when unmapped. */
  label: string;
  description?: string;
  hiddenByDefault: boolean;
  /** text | int | bool | date. Drives the create form's input and parsing. */
  type: string;
  /** Must be filled in when adding a row. */
  required: boolean;
  /** Visual family — pricing, ota, credentials. Null for sheet-backed lists. */
  group?: string | null;
}

/** How long a fetched tab is reused before going back to Google. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  fetchedAt: number;
  columns: string[];
  rows: string[][];
  /**
   * Keyed by squashed column name, but holding a LIST per key: this sheet
   * repeats header names (`status` twice, `bedroom`, `bathroom`), and the
   * mapping sheet repeats them too — once per meaning. Entries are consumed
   * in order as the data columns are walked, so the first `status` gets the
   * first mapping row and the second gets the second.
   */
  mapping: Map<string, Array<{ label?: string; description?: string }>>;
  /** Which tab the mapping actually came from, for the UI to disclose. */
  mappingTab: string | null;
}

@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: GoogleSheetsClient,
  ) {}

  list() {
    return TABS.map(({ key, label }) => ({ key, label }));
  }

  /**
   * Which columns a role may see.
   *
   * Today: everything, for the two roles that can reach the module at all.
   * This function exists so that stays a one-place decision. The sheet holds
   * channel passwords, Ubyport credentials and lockbox codes in plain text, so
   * the moment a third role gets in here, the answer has to change — and it
   * has to change by returning a WHITELIST. A deny-list over 140 columns is a
   * bet that nobody ever adds a 141st called `passwordSomethingElse`.
   *
   * Note this is a different thing from HIDDEN_BY_DEFAULT: that is tidiness,
   * one click from being undone. This is permission.
   */
  private visibleColumns(columns: string[], _role: UserRole): string[] {
    return columns;
  }

  /**
   * The same decision for a migrated list, where the metadata says which
   * columns are credentials and which are personal data.
   *
   * Today's behaviour is preserved exactly: MANAGER and ADMIN are the only
   * roles that can reach this module at all, and they keep seeing everything.
   * The change is what happens to the roles added since — DIRECTOR, EVIDENCE,
   * RESOLUTIONS, MARKETING_MANAGER. If one of them is ever granted the module,
   * it gets the list without the mailbox passwords and without the birth
   * numbers, rather than everything by default.
   *
   * This is the whitelist seam, not the whitelist. When the privilege matrix
   * lands it replaces this function; until then the failure mode of a new role
   * is "sees less than expected", which is the right way round.
   */
  private visibleFields<T extends { field: string; sensitive: boolean }>(
    fields: T[],
    role: UserRole,
  ): T[] {
    const mayReadSensitive = role === 'MANAGER' || role === 'ADMIN';
    return mayReadSensitive ? fields : fields.filter((f) => !f.sensitive);
  }

  /**
   * Postgres values back to the strings the viewer speaks.
   *
   * The grid was built for a spreadsheet and every cell in it is a string.
   * Keeping that contract is what let this list migrate without the frontend
   * changing at all — booleans render in the sheet's own TRUE/FALSE vocabulary
   * so a migrated column reads identically to an unmigrated one beside it.
   */
  private render(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  }

  private async readMapping(
    spreadsheetId: string,
    tab: string,
  ): Promise<{
    mapping: Map<string, Array<{ label?: string; description?: string }>>;
    mappingTab: string | null;
  }> {
    const mapping = new Map<string, Array<{ label?: string; description?: string }>>();
    const wanted = squash(`${MAPPING_PREFIX}${tab}`);

    // Ask the spreadsheet what it actually contains rather than guessing a
    // name. The first version guessed `mapping` + the data tab's spelling and
    // silently found nothing, because the two tabs spell "Accommodation"
    // differently from each other.
    const tabs = await this.sheets.listTabs(spreadsheetId);
    const name =
      tabs.find((t) => squash(t) === wanted) ??
      tabs.find((t) => squash(t).startsWith(squash(MAPPING_PREFIX)) && squash(t).includes(squash(tab))) ??
      null;

    if (!name) {
      this.logger.warn(
        `No mapping tab for "${tab}". Looked for something like ` +
        `"${MAPPING_PREFIX}${tab}" among: ${tabs.join(', ') || '(none listed)'}`,
      );
      return { mapping, mappingTab: null };
    }

    const values = await this.sheets.readValues(spreadsheetId, name, { optional: true });
    if (!values) return { mapping, mappingTab: null };

    // Row 1 is the mapping sheet's own header; data starts at row 2.
    // Keys are squashed too, so a stray space or capital in either sheet does
    // not quietly cost a label.
    for (const row of values.slice(1)) {
      const source = (row[MAP_COL_SOURCE] ?? '').trim();
      if (!source) continue;
      const label = (row[MAP_COL_LABEL] ?? '').trim();
      const description = (row[MAP_COL_DESCRIPTION] ?? '').trim();
      // Append rather than overwrite. Keyed assignment let a second, blank row
      // for a repeated name wipe out the good label from the first one — which
      // is exactly how `status` lost its label while its mapping row sat there
      // plainly filled in.
      const key = squash(source);
      const list = mapping.get(key) ?? [];
      list.push({
        label: label || undefined,
        description: description || undefined,
      });
      mapping.set(key, list);
    }

    this.logger.log(`Loaded ${mapping.size} column mapping(s) from "${name}"`);
    return { mapping, mappingTab: name };
  }

  async read(
    tenantId: string,
    key: string,
    role: UserRole,
    opts: { refresh?: boolean } = {},
  ) {
    const entry = TABS.find((t) => t.key === key);
    if (!entry) {
      throw new NotFoundException(`Unknown dataset "${key}"`);
    }

    if (entry.source === 'db') {
      return this.readFromDb(tenantId, entry.key, entry.label, role);
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { datasetsSheetId: true },
    });
    const spreadsheetId = tenant?.datasetsSheetId;
    if (!spreadsheetId) {
      throw new BadRequestException(
        'No spreadsheet is configured for this tenant. Paste the sheet URL in ' +
        'Settings -> PMS Integration -> Datasets source, and share the sheet ' +
        'with the service account as Viewer.',
      );
    }

    const cacheKey = `${tenantId}:${entry.key}`;
    const cached = this.cache.get(cacheKey);
    const fresh =
      cached && !opts.refresh && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

    let columns: string[];
    let rows: string[][];
    let mapping: CacheEntry['mapping'];
    let mappingTab: string | null;
    let fetchedAt: number;

    if (fresh) {
      ({ columns, rows, mapping, mappingTab, fetchedAt } = cached!);
    } else {
      const [read, map] = await Promise.all([
        this.sheets.readTab(spreadsheetId, entry.tab),
        this.readMapping(spreadsheetId, entry.tab),
      ]);
      columns = read.columns;
      rows = read.rows;
      mapping = map.mapping;
      mappingTab = map.mappingTab;
      fetchedAt = Date.now();
      this.cache.set(cacheKey, { fetchedAt, columns, rows, mapping, mappingTab });
      this.logger.log(
        `Read ${rows.length} row(s) × ${columns.length} column(s) from "${entry.tab}"`,
      );
    }

    // Project down to what this role may see. Index-based, so duplicated
    // header names survive intact.
    const allowed = new Set(this.visibleColumns(columns, role));
    const keptIndexes = columns
      .map((c, i) => (allowed.has(c) ? i : -1))
      .filter((i) => i >= 0);

    // Walking in column order lets repeated names line up with their repeated
    // mapping rows. Past the end of the list we reuse the last entry, and a
    // blank label falls back to any earlier entry that has one — a duplicate
    // row left half-filled should not cost the column its name.
    const seen = new Map<string, number>();
    const shaped: DatasetColumn[] = keptIndexes.map((i) => {
      const key = columns[i];
      const squashed = squash(key);
      const list = mapping.get(squashed) ?? [];
      const nth = seen.get(squashed) ?? 0;
      seen.set(squashed, nth + 1);

      const entry = list[Math.min(nth, list.length - 1)];
      const label = entry?.label ?? list.find((e) => e.label)?.label;
      const description = entry?.description ?? list.find((e) => e.description)?.description;

      return {
        key,
        label: label ?? key,
        description,
        hiddenByDefault: HIDDEN_BY_DEFAULT.includes(key),
        type: 'text',
        required: false,
        group: null,
      };
    });

    return {
      key: entry.key,
      label: entry.label,
      tab: entry.tab,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached: Boolean(fresh),
      mapped: mapping.size > 0,
      mappingTab,
      columns: shaped,
      rows: rows.map((row) => keptIndexes.map((i) => row[i])),
      totalColumns: columns.length,
      // The app has read-only scope on the spreadsheet, so a sheet-backed list
      // cannot be added to. Saying so here is what greys out "Add new" rather
      // than letting the button fail on submit.
      canCreate: false,
    };
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  /**
   * Export a dataset as CSV or XLSX.
   *
   * The whole design is one sentence: **this calls `read()`**. Not a query of
   * its own, not a copy of the column projection — the same method that builds
   * the screen. That is what makes "the export contains exactly what this role
   * may see" a structural fact instead of a promise. A second query would be a
   * second place to forget `sensitive`, and the day those two drift is the day
   * a spreadsheet of mailbox passwords walks out of the building.
   *
   * The client may send its current view — visible columns, filters, search,
   * sort — so the file matches what is on screen. Every one of those can only
   * ever NARROW the result: unknown column keys are dropped rather than
   * honoured, so asking for a column the role cannot read returns nothing
   * extra. The filtering mirrors the frontend's so the row counts agree; if
   * they ever diverge the damage is cosmetic, because the projection above is
   * not duplicated here.
   */
  async exportDataset(
    tenantId: string,
    key: string,
    role: UserRole,
    actorId: string | undefined,
    opts: {
      format?: string;
      columns?: string[];
      search?: string;
      filters?: Record<string, string[]>;
      sort?: { key: string; dir: 'asc' | 'desc' };
    },
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const format = opts.format === 'xlsx' ? 'xlsx' : 'csv';
    const page = await this.read(tenantId, key, role);

    // Intersect, never union. The request picks from what came back; it cannot
    // add to it.
    const permitted = page.columns;
    const wanted = opts.columns?.length
      ? permitted.filter((c) => opts.columns!.includes(c.key))
      : permitted.filter((c) => !c.hiddenByDefault);
    const chosen = wanted.length > 0 ? wanted : permitted;
    const indexes = chosen.map((c) => permitted.findIndex((p) => p.key === c.key));

    // ── the same filtering the viewer does ──────────────────────────────────
    const q = (opts.search ?? '').trim().toLowerCase();
    const active = Object.entries(opts.filters ?? {}).filter(([, v]) => v?.length);

    let rows = page.rows.filter((row) => {
      for (const [k, allowed] of active) {
        const i = permitted.findIndex((c) => c.key === k);
        if (i >= 0 && !allowed.includes(row[i] ?? '')) return false;
      }
      if (!q) return true;
      return row.some((cell) => cell?.toLowerCase().includes(q));
    });

    if (opts.sort) {
      const i = permitted.findIndex((c) => c.key === opts.sort!.key);
      if (i >= 0) {
        const dir = opts.sort.dir === 'asc' ? 1 : -1;
        rows = [...rows].sort((a, b) => {
          const x = a[i] ?? '', y = b[i] ?? '';
          if (!x && !y) return 0;
          if (!x) return 1;
          if (!y) return -1;
          const nx = Number(x.replace(',', '.')), ny = Number(y.replace(',', '.'));
          if (!Number.isNaN(nx) && !Number.isNaN(ny)) return (nx - ny) * dir;
          return x.localeCompare(y, undefined, { numeric: true }) * dir;
        });
      }
    }

    const projected = rows.map((row) => indexes.map((i) => row[i] ?? ''));

    // ── audit ───────────────────────────────────────────────────────────────
    // An export is the single most consequential thing this module does: it
    // takes data that was read one screen at a time and turns it into a file
    // that leaves. Which sensitive columns went with it is recorded by name,
    // because "who has a spreadsheet of the mailbox passwords" is a question
    // that gets asked after the fact or not at all.
    const sensitiveTaken = await this.sensitiveAmong(tenantId, key, chosen.map((c) => c.key));
    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { email: true } })
      : null;

    await this.prisma.auditEvent.create({
      data: {
        tenantId,
        category: 'DATA_EDIT',
        action: `dataset.${key}.export`,
        actorId: actorId ?? null,
        actorEmail: actor?.email ?? null,
        targetType: `dataset:${key}`,
        targetId: null,
        metadata: {
          format,
          rows: projected.length,
          columns: chosen.length,
          filtered: rows.length !== page.rows.length,
          sensitiveColumns: sensitiveTaken,
        },
      },
    });

    this.logger.log(
      `Export ${key} as ${format}: ${projected.length} row(s) x ${chosen.length} column(s) ` +
      `by ${actor?.email ?? 'unknown'}` +
      (sensitiveTaken.length ? ` — including ${sensitiveTaken.length} sensitive column(s)` : ''),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${key}-${stamp}`;
    const cols = chosen.map((c) => ({ key: c.key, label: c.label }));

    return format === 'xlsx'
      ? {
          filename: `${base}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: await toXlsx(cols, projected, page.label),
        }
      : {
          filename: `${base}.csv`,
          contentType: 'text/csv; charset=utf-8',
          body: toCsv(cols, projected),
        };
  }

  /** Which of these columns are marked sensitive. Empty for sheet-backed lists. */
  private async sensitiveAmong(
    tenantId: string,
    dataset: string,
    keys: string[],
  ): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.prisma.datasetField.findMany({
      where: { tenantId, dataset, sensitive: true, field: { in: keys } },
      select: { field: true },
    });
    return rows.map((r) => r.field);
  }

  // ─── Postgres-backed lists ────────────────────────────────────────────────

  /**
   * Read a migrated list.
   *
   * Three things the sheet path had to work around simply do not exist here.
   * Column order is a number rather than a position. Names cannot drift,
   * because the metadata row and the table column are the same string enforced
   * by a unique index instead of matched by a fuzzy `squash()`. And no list can
   * repeat a column name, so the whole "consume mapping entries in column
   * order" dance that `status` needed is gone.
   */
  private async readFromDb(
    tenantId: string,
    key: string,
    label: string,
    role: UserRole,
  ) {
    const spec = DB_MODELS[key];
    if (!spec) throw new NotFoundException(`Dataset "${key}" has no table behind it`);

    // Base metadata, plus this role's overrides in one round trip. The
    // override rows are sparse — a role that has never been tuned has none.
    const all = await this.prisma.datasetField.findMany({
      where: { tenantId, dataset: key },
      orderBy: { columnOrder: 'asc' },
      include: { overrides: { where: { role } } },
    });

    if (all.length === 0) {
      throw new BadRequestException(
        `The "${key}" dataset has no columns yet. Run ` +
        `\`npm run import:cdm -- --tenant <slug> --list ${key} --apply\` to load it.`,
      );
    }

    // Apply the role's overrides, then re-sort. Note what an override may do:
    // move a column and hide it. It cannot reveal one — a `sensitive` field
    // stays filtered out below no matter what the override says, so a
    // reordering table can never become a back door into the passwords.
    const tuned = all
      .map((f) => {
        const o = f.overrides[0];
        return {
          ...f,
          columnOrder: o?.columnOrder ?? f.columnOrder,
          hiddenByDefault: o?.hidden ?? f.hiddenByDefault,
        };
      })
      .sort((a, b) => a.columnOrder - b.columnOrder || a.field.localeCompare(b.field));

    const fields = this.visibleFields(tuned, role);
    const delegate = (this.prisma as any)[spec.model];

    const select: Record<string, true> = {};
    for (const f of fields) select[f.field] = true;

    const records: Record<string, unknown>[] = await delegate.findMany({
      where: { tenantId },
      select,
      orderBy: { [spec.key]: 'asc' },
    });

    return {
      key,
      label,
      tab: null,
      fetchedAt: new Date().toISOString(),
      // Postgres is faster than the cache the sheet needed, so there is none
      // and nothing is ever stale.
      cached: false,
      mapped: true,
      mappingTab: null,
      columns: fields.map((f) => ({
        key: f.field,
        label: f.displayName,
        description: f.description ?? undefined,
        hiddenByDefault: f.hiddenByDefault,
        type: f.type,
        required: f.required,
        group: f.group,
      })),
      rows: records.map((r) => fields.map((f) => this.render(r[f.field]))),
      totalColumns: all.length,
      canCreate: true,
    };
  }

  /**
   * Add a row to a migrated list.
   *
   * Everything the request may set is derived from the metadata, so an unknown
   * key is rejected rather than ignored, and a sensitive column cannot be
   * written by a role that is not allowed to read it.
   */
  async create(
    tenantId: string,
    key: string,
    role: UserRole,
    actorId: string | undefined,
    body: Record<string, unknown>,
  ) {
    const entry = TABS.find((t) => t.key === key);
    if (!entry) throw new NotFoundException(`Unknown dataset "${key}"`);
    if (entry.source !== 'db') {
      throw new BadRequestException(
        `"${entry.label}" still lives in the spreadsheet, which this app can only read.`,
      );
    }

    const spec = DB_MODELS[key];
    const all = await this.prisma.datasetField.findMany({
      where: { tenantId, dataset: key },
      orderBy: { columnOrder: 'asc' },
    });
    const writable = this.visibleFields(all, role);
    const byField = new Map(writable.map((f) => [f.field, f]));

    const unknown = Object.keys(body).filter((k) => !byField.has(k));
    if (unknown.length) {
      throw new BadRequestException(`Unknown or not-writable column(s): ${unknown.join(', ')}`);
    }

    const data: Record<string, unknown> = { tenantId };
    for (const f of writable) {
      const raw = body[f.field];
      const str = raw === null || raw === undefined ? '' : String(raw).trim();

      if (!str) {
        if (f.required) throw new BadRequestException(`"${f.displayName}" is required.`);
        continue;
      }

      if (f.type === 'int') {
        const n = Number(str);
        if (!Number.isFinite(n)) throw new BadRequestException(`"${f.displayName}" must be a number.`);
        data[f.field] = Math.trunc(n);
      } else if (f.type === 'bool') {
        data[f.field] = ['true', 'yes', '1'].includes(str.toLowerCase());
      } else if (f.type === 'date') {
        const d = new Date(str);
        if (isNaN(d.getTime())) throw new BadRequestException(`"${f.displayName}" must be a date.`);
        data[f.field] = d;
      } else {
        data[f.field] = str;
      }
    }

    const naturalKey = data[spec.key];
    if (!naturalKey) throw new BadRequestException(`"${spec.key}" is required.`);

    const delegate = (this.prisma as any)[spec.model];
    const clash = await delegate.findUnique({
      where: { [`tenantId_${spec.key}`]: { tenantId, [spec.key]: naturalKey } },
      select: { [spec.pk]: true },
    });
    if (clash) {
      throw new BadRequestException(`${spec.key} "${naturalKey}" already exists.`);
    }

    // The email is denormalised onto the audit row rather than left to the
    // foreign key. A person can leave and their account can go; the record of
    // what they did must not go with it.
    const actor = actorId
      ? await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { email: true },
        })
      : null;

    // The row and its audit entry go in together. An audit row written after
    // the commit is an audit row that sometimes does not exist.
    return this.prisma.$transaction(async (tx) => {
      const created = await (tx as any)[spec.model].create({ data });
      const createdId: string = created[spec.pk];

      await tx.auditEvent.create({
        data: {
          tenantId,
          category: 'DATA_EDIT',
          action: `dataset.${key}.create`,
          actorId: actorId ?? null,
          actorEmail: actor?.email ?? null,
          targetType: `dataset:${key}`,
          targetId: createdId,
          // Values are deliberately not recorded here: this row can carry
          // mailbox passwords, and an audit log is not a second place to keep
          // them. What was created, by whom and when is the useful part.
          metadata: { fields: Object.keys(data).filter((k) => k !== 'tenantId') },
        },
      });

      this.logger.log(`Created ${key} row ${createdId} (${naturalKey}) by ${actor?.email ?? 'unknown'}`);
      return { id: createdId, [spec.key]: naturalKey };
    });
  }
}
