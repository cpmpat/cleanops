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

export type DatasetKey = (typeof TABS)[number]['key'];

/** How long a fetched tab is reused before going back to Google. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  fetchedAt: number;
  columns: string[];
  rows: string[][];
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
   */
  private visibleColumns(columns: string[], _role: UserRole): string[] {
    return columns;
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
    let fetchedAt: number;

    if (fresh) {
      ({ columns, rows, fetchedAt } = cached!);
    } else {
      const read = await this.sheets.readTab(spreadsheetId, entry.tab);
      columns = read.columns;
      rows = read.rows;
      fetchedAt = Date.now();
      this.cache.set(cacheKey, { fetchedAt, columns, rows });
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

    return {
      key: entry.key,
      label: entry.label,
      tab: entry.tab,
      fetchedAt: new Date(fetchedAt).toISOString(),
      cached: Boolean(fresh),
      columns: keptIndexes.map((i) => columns[i]),
      rows: rows.map((row) => keptIndexes.map((i) => row[i])),
      totalColumns: columns.length,
    };
  }
}
