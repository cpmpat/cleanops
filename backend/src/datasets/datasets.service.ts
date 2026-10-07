import {
  Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException,
} from '@nestjs/common';
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
/** Where a list's rows live: Postgres, or read live from the CDM sheet. */
export type ListSource = 'db' | 'sheet';
export const TABS: ReadonlyArray<{ key: string; tab: string; label: string; source: ListSource }> = [
  { key: 'accommodation', tab: 'Accommodation', label: 'Accommodation', source: 'db'    },
  { key: 'user',          tab: 'User',         label: 'User',          source: 'db'    },
  { key: 'owner',         tab: 'Owner',        label: 'Owner',         source: 'db'    },
  { key: 'oxpoint',       tab: 'OX Point',     label: 'OX Point',      source: 'db'    },
];

/**
 * Which Prisma model backs a migrated list, and what its natural key is.
 *
 * The delegate is looked up by name rather than imported, which is what keeps
 * `read` and `create` generic across lists. The names here are the only place
 * that indirection is resolved, so a typo fails loudly at the first request
 * rather than silently returning nothing.
 */
export const DB_MODELS: Record<string, { model: string; key: string; pk: string }> = {
  user:          { model: 'cdmUser',          key: 'internalId', pk: 'id'    },
  // The primary key is `rowId` here: the Accomodation sheet has its own column
  // called `id`, which would otherwise collide with Prisma's.
  accommodation: { model: 'cdmAccommodation', key: 'idAvantio',  pk: 'rowId' },
  // Same `id`-column collision as Accommodation, same answer.
  oxpoint:       { model: 'cdmOxPoint',       key: 'id',         pk: 'rowId' },
  // Moved from the sheet 6 Oct 2026. Same `id` collision again.
  owner:         { model: 'cdmOwner',         key: 'id',         pk: 'rowId' },
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
export function squash(name: string): string {
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
  /** What this role may do with the column. Sheet-backed lists are always 'view'. */
  access?: 'view' | 'edit';
  /** Allowed values of a pick-list column (active ones, in order). */
  options?: string[];
  /** Credentials / personal data. Changes are audited without their values. */
  sensitive?: boolean;
}

/** Roles that keep today's access to the sheet-backed lists (Owner). */
const SHEET_READERS: string[] = ['MANAGER', 'ADMIN'];

const STALE_MESSAGE =
  'Someone else changed this record since you opened it. Reload to see their ' +
  'changes, then make yours again.';

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

  /**
   * The lists this role may open: any list the matrix grants the role at least
   * one column of. MANAGER and ADMIN also keep every sheet-backed list, as they
   * always have.
   */
  async list(tenantId: string, role: UserRole) {
    const granted = await this.prisma.datasetFieldAccess.findMany({
      where: { tenantId, role, canView: true },
      distinct: ['dataset'],
      select: { dataset: true },
    });
    const has = new Set(granted.map((g: { dataset: string }) => g.dataset));
    return TABS
      .filter((t) => has.has(t.key) || (t.source === 'sheet' && SHEET_READERS.includes(role)))
      .map(({ key, label }) => ({ key, label }));
  }

  /**
   * Which columns of a sheet-backed list a role may see.
   *
   * MANAGER and ADMIN: every column, as before. Everyone else: exactly the
   * columns the access matrix grants them — a WHITELIST, so a column added to
   * the sheet tomorrow stays hidden until someone grants it. Header names are
   * compared squashed (case, spaces and punctuation ignored), so a stray
   * space or capital in the sheet's header row does not cost a grant.
   *
   * Sheet-backed lists are read-only to the app, so an edit grant here means
   * nothing more than view.
   */
  private async visibleColumns(
    tenantId: string,
    dataset: string,
    columns: string[],
    role: UserRole,
  ): Promise<string[]> {
    if (SHEET_READERS.includes(role)) return columns;
    const access = await this.accessFor(tenantId, dataset, role);
    const granted = new Set([...access.keys()].map(squash));
    return columns.filter((c) => granted.has(squash(c)));
  }

  /**
   * The access matrix for one role on one migrated list: field → 'view' |
   * 'edit'. A field with no grant, or a grant with canView false, is absent —
   * default deny. ~170 indexed rows, read per request: small enough that a
   * cache would only add a way for a revoked grant to linger.
   */
  private async accessFor(
    tenantId: string,
    dataset: string,
    role: UserRole,
  ): Promise<Map<string, 'view' | 'edit'>> {
    const grants = await this.prisma.datasetFieldAccess.findMany({
      where: { tenantId, dataset, role, canView: true },
      select: { field: true, canEdit: true },
    });
    return new Map(grants.map((g: { field: string; canEdit: boolean }) => [g.field, g.canEdit ? 'edit' : 'view'] as const));
  }

  /**
   * The rows a role may see on one list, as a Prisma `where` fragment
   * (dataset_row_filters; e.g. TERENAK: Accommodation where source is
   * "Avantio"). Empty for a role with no filter — every row. Read per request
   * for the same reason as the access matrix: nothing to go stale.
   */
  private async rowFilter(tenantId: string, dataset: string, role: UserRole): Promise<Record<string, unknown>> {
    const filters = await this.prisma.datasetRowFilter.findMany({
      where: { tenantId, dataset, role },
      select: { field: true, values: true },
    });
    if (filters.length === 0) return {};
    return { AND: filters.map((f: { field: string; values: string[] }) => ({ [f.field]: { in: f.values } })) };
  }

  /** Active pick-list values for the given lists, in their sort order. */
  private async picklists(tenantId: string, lists: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (lists.length === 0) return out;
    const rows = await this.prisma.datasetPicklistValue.findMany({
      where: { tenantId, list: { in: lists }, active: true },
      orderBy: [{ list: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
      select: { list: true, value: true },
    });
    for (const r of rows) out.set(r.list, [...(out.get(r.list) ?? []), r.value]);
    return out;
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
    // Refuse before touching the spreadsheet: a role with no grant on this
    // list learns nothing, not even how many rows it has.
    if (!SHEET_READERS.includes(role)) {
      const access = await this.accessFor(tenantId, entry.key, role);
      if (access.size === 0) {
        throw new ForbiddenException(`No access to "${entry.label}"`);
      }
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
    const allowed = new Set(await this.visibleColumns(tenantId, entry.key, columns, role));
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
        access: 'view' as const,
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
      // How wide the sheet is would itself hint at what is withheld; only the
      // roles that see everything get the true number.
      totalColumns: SHEET_READERS.includes(role) ? columns.length : keptIndexes.length,
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
    const [all, access] = await Promise.all([
      this.prisma.datasetField.findMany({
        where: { tenantId, dataset: key },
        orderBy: { columnOrder: 'asc' },
        include: { overrides: { where: { role } } },
      }),
      this.accessFor(tenantId, key, role),
    ]);

    if (all.length === 0) {
      throw new BadRequestException(
        `The "${key}" dataset has no columns yet. Run ` +
        `\`npm run import:cdm -- --tenant <slug> --list ${key} --apply\` to load it.`,
      );
    }

    // Apply the role's overrides, then re-sort. Note what an override may do:
    // move a column and hide it. It cannot reveal one — only the access
    // matrix below decides what is sent, so a reordering table can never
    // become a back door into the passwords.
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

    // The matrix is the whole decision: a column without a view grant is not
    // selected, so its values never leave the database.
    const fields = tuned.filter((f) => access.has(f.field));
    if (fields.length === 0) throw new ForbiddenException(`No access to "${label}"`);

    const options = await this.picklists(
      tenantId,
      [...new Set(fields.map((f) => f.picklist).filter((l): l is string => !!l))],
    );
    const delegate = (this.prisma as any)[spec.model];

    // The row's key and version travel with it but are not columns: the key
    // addresses a save, the version (updatedAt) detects a concurrent edit.
    const select: Record<string, true> = { [spec.pk]: true, updatedAt: true };
    for (const f of fields) select[f.field] = true;

    const records: Record<string, unknown>[] = await delegate.findMany({
      where: { tenantId, ...(await this.rowFilter(tenantId, key, role)) },
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
        access: access.get(f.field)!,
        options: f.picklist ? options.get(f.picklist) ?? [] : undefined,
        sensitive: f.sensitive,
      })),
      rows: records.map((r) => fields.map((f) => this.render(r[f.field]))),
      rowIds: records.map((r) => String(r[spec.pk])),
      versions: records.map((r) => (r.updatedAt as Date).toISOString()),
      totalColumns: all.length,
      // Adding records is switched off for every list and every role for now.
      canCreate: false,
      canEdit: fields.some((f) => access.get(f.field) === 'edit'),
    };
  }

  /**
   * Adding records is switched off for every list and every role. It will
   * come back behind a table-level grant; until then the endpoint says so
   * rather than half-working.
   */
  async create(): Promise<never> {
    throw new ForbiddenException('Adding new records is switched off.');
  }

  /**
   * Save one row's edits.
   *
   * Every field in `values` must carry an edit grant for this role — one
   * field without it rejects the whole save, so a row never half-saves.
   * Values are parsed by the column's type and checked against its pick list.
   * `version` is the row's updatedAt as the client read it: if the row moved
   * since, the save is refused with 409 instead of silently overwriting
   * someone else's change.
   *
   * The change and its audit go in one transaction: one AuditEvent for the
   * save, one DatasetFieldChange per field that actually changed, each with
   * the actor's email and role.
   */
  async update(
    tenantId: string,
    key: string,
    role: UserRole,
    actorId: string | undefined,
    rowId: string,
    body: { version?: string; values?: Record<string, unknown> },
  ) {
    const entry = TABS.find((t) => t.key === key);
    if (!entry) throw new NotFoundException(`Unknown dataset "${key}"`);
    if (entry.source !== 'db') {
      throw new BadRequestException(`"${entry.label}" is read from the spreadsheet and cannot be edited here.`);
    }
    const spec = DB_MODELS[key];
    const values = body?.values ?? {};
    const keys = Object.keys(values);
    if (keys.length === 0) throw new BadRequestException('Nothing to save.');
    if (!body?.version) throw new BadRequestException('version is required.');

    const [fields, access] = await Promise.all([
      this.prisma.datasetField.findMany({ where: { tenantId, dataset: key, field: { in: keys } } }),
      this.accessFor(tenantId, key, role),
    ]);
    const byField = new Map(fields.map((f) => [f.field, f]));
    const denied = keys.filter((k) => !byField.has(k) || access.get(k) !== 'edit');
    if (denied.length) {
      throw new ForbiddenException(`You cannot edit: ${denied.join(', ')}`);
    }

    const allowed = await this.picklists(
      tenantId,
      [...new Set(fields.map((f) => f.picklist).filter((l): l is string => !!l))],
    );
    const data: Record<string, unknown> = {};
    for (const k of keys) data[k] = this.parse(byField.get(k)!, values[k], allowed);

    // Denormalised onto every audit row: a person can leave and their account
    // can go; the record of what they changed must not go with it.
    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { email: true } })
      : null;
    const actorEmail = actor?.email ?? null;

    const select: Record<string, true> = { updatedAt: true };
    for (const k of keys) select[k] = true;
    // A row outside the role's row filter is "not found", exactly as if it
    // did not exist — saving cannot reach what reading cannot.
    const rows = await this.rowFilter(tenantId, key, role);

    return this.prisma.$transaction(async (tx) => {
      const model = (tx as any)[spec.model];
      const current = await model.findFirst({ where: { tenantId, [spec.pk]: rowId, ...rows }, select });
      if (!current) throw new NotFoundException('Record not found');
      if ((current.updatedAt as Date).toISOString() !== body.version) {
        throw new ConflictException(STALE_MESSAGE);
      }

      const changed = keys.filter((k) => this.render(current[k]) !== this.render(data[k]));
      if (changed.length === 0) {
        return { changed: [] as string[], version: body.version, values: {} as Record<string, string> };
      }

      // Conditional on the version we just read: a save that raced ours
      // between the read and here makes this match nothing.
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of changed) patch[k] = data[k];
      const res = await model.updateMany({
        where: { tenantId, [spec.pk]: rowId, updatedAt: current.updatedAt, ...rows },
        data: patch,
      });
      if (res.count !== 1) throw new ConflictException(STALE_MESSAGE);

      const after = await model.findFirst({ where: { tenantId, [spec.pk]: rowId }, select });

      const event = await tx.auditEvent.create({
        data: {
          tenantId,
          category: 'DATA_EDIT',
          action: `dataset.${key}.update`,
          actorId: actorId ?? null,
          actorEmail,
          targetType: `dataset:${key}`,
          targetId: rowId,
          metadata: { role, fields: changed },
        },
      });
      await tx.datasetFieldChange.createMany({
        data: changed.map((k) => {
          const masked = byField.get(k)!.sensitive;
          return {
            tenantId,
            eventId: event.id,
            dataset: key,
            rowId,
            field: k,
            oldValue: masked ? null : this.render(current[k]) || null,
            newValue: masked ? null : this.render(after[k]) || null,
            masked,
            actorEmail,
            actorRole: role,
            createdAt: event.createdAt,
          };
        }),
      });

      this.logger.log(`Updated ${key} row ${rowId} (${changed.join(', ')}) by ${actorEmail ?? 'unknown'} as ${role}`);
      return {
        changed,
        version: (after.updatedAt as Date).toISOString(),
        values: Object.fromEntries(changed.map((k) => [k, this.render(after[k])])),
      };
    });
  }

  /**
   * Change history of one row, newest first — only for the fields this role
   * may see, so history is never a side door into a column's values. Changes
   * to sensitive columns (recorded without values: who and when only) are
   * shown to ADMIN alone.
   */
  async history(tenantId: string, key: string, role: UserRole, rowId: string) {
    const access = await this.accessFor(tenantId, key, role);
    if (access.size === 0) throw new ForbiddenException('No access to this list');
    const spec = DB_MODELS[key];
    const rows = await this.rowFilter(tenantId, key, role);
    if (spec && Object.keys(rows).length > 0) {
      const visible = await (this.prisma as any)[spec.model].count({ where: { tenantId, [spec.pk]: rowId, ...rows } });
      if (visible === 0) throw new NotFoundException('Record not found');
    }
    return this.prisma.datasetFieldChange.findMany({
      where: {
        tenantId, dataset: key, rowId, field: { in: [...access.keys()] },
        ...(role === 'ADMIN' ? {} : { masked: false }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, field: true, oldValue: true, newValue: true, masked: true,
        actorEmail: true, actorRole: true, createdAt: true,
      },
    });
  }

  /** One submitted value → what the column stores. Empty means null. */
  private parse(
    f: { field: string; displayName: string; type: string; required: boolean; picklist: string | null },
    raw: unknown,
    allowed: Map<string, string[]>,
  ): unknown {
    const str = raw === null || raw === undefined ? '' : String(raw).trim();
    if (!str) {
      if (f.required) throw new BadRequestException(`"${f.displayName}" is required.`);
      return null;
    }
    if (f.picklist) {
      const ok = allowed.get(f.picklist) ?? [];
      if (!ok.includes(str)) {
        throw new BadRequestException(`"${f.displayName}" must be one of: ${ok.join(', ')}.`);
      }
      return str;
    }
    const num = Number(str.replace(',', '.'));
    switch (f.type) {
      case 'int':
        if (!Number.isInteger(num)) throw new BadRequestException(`"${f.displayName}" must be a whole number.`);
        return num;
      case 'float':
        if (!Number.isFinite(num)) throw new BadRequestException(`"${f.displayName}" must be a number.`);
        return num;
      case 'decimal':
        if (!Number.isFinite(num)) throw new BadRequestException(`"${f.displayName}" must be a number.`);
        return str.replace(',', '.');
      case 'bool': {
        const u = str.toUpperCase();
        if (u === 'TRUE') return true;
        if (u === 'FALSE') return false;
        throw new BadRequestException(`"${f.displayName}" must be TRUE or FALSE.`);
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || isNaN(new Date(`${str}T00:00:00Z`).getTime())) {
          throw new BadRequestException(`"${f.displayName}" must be a date (YYYY-MM-DD).`);
        }
        return new Date(`${str}T00:00:00Z`);
      default:
        return str;
    }
  }
}
