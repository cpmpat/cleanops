import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GoogleSheetsClient } from './google-sheets.client';
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
  { key: 'accommodation', tab: 'Accomodation', label: 'Accommodation' },
  { key: 'user',          tab: 'User',         label: 'User' },
  { key: 'owner',         tab: 'Owner',        label: 'Owner' },
] as const;

/**
 * Columns nobody wants in the default view. Still listed in the column picker,
 * so they are hidden rather than censored — anyone who needs one ticks it back.
 */
const HIDDEN_BY_DEFAULT = [
  'idBh',
  'feeFinalCleaningVatExl',
  'feeFinalCleaningVatRate',
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
}

/** How long a fetched tab is reused before going back to Google. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  fetchedAt: number;
  columns: string[];
  rows: string[][];
  mapping: Map<string, { label?: string; description?: string }>;
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

  private async readMapping(
    spreadsheetId: string,
    tab: string,
  ): Promise<Map<string, { label?: string; description?: string }>> {
    const mapping = new Map<string, { label?: string; description?: string }>();
    const name = `${MAPPING_PREFIX}${tab}`;

    const values = await this.sheets.readValues(spreadsheetId, name, { optional: true });
    if (!values) return mapping;

    // Row 1 is the mapping sheet's own header; data starts at row 2.
    for (const row of values.slice(1)) {
      const source = (row[MAP_COL_SOURCE] ?? '').trim();
      if (!source) continue;
      const label = (row[MAP_COL_LABEL] ?? '').trim();
      const description = (row[MAP_COL_DESCRIPTION] ?? '').trim();
      mapping.set(source, {
        label: label || undefined,
        description: description || undefined,
      });
    }

    this.logger.log(`Loaded ${mapping.size} column mapping(s) from "${name}"`);
    return mapping;
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
    let fetchedAt: number;

    if (fresh) {
      ({ columns, rows, mapping, fetchedAt } = cached!);
    } else {
      const [read, map] = await Promise.all([
        this.sheets.readTab(spreadsheetId, entry.tab),
        this.readMapping(spreadsheetId, entry.tab),
      ]);
      columns = read.columns;
      rows = read.rows;
      mapping = map;
      fetchedAt = Date.now();
      this.cache.set(cacheKey, { fetchedAt, columns, rows, mapping });
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

    const shaped: DatasetColumn[] = keptIndexes.map((i) => {
      const key = columns[i];
      const m = mapping.get(key);
      return {
        key,
        label: m?.label ?? key,
        description: m?.description,
        hiddenByDefault: HIDDEN_BY_DEFAULT.includes(key),
      };
    });

    return {
      key: entry.key,
      label: entry.label,
      tab: entry.tab,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached: Boolean(fresh),
      mapped: mapping.size > 0,
      columns: shaped,
      rows: rows.map((row) => keptIndexes.map((i) => row[i])),
      totalColumns: columns.length,
    };
  }
}
