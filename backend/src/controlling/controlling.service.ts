import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { PrismaService } from '../common/prisma.service';

/**
 * Controlling (Oct 2026): tables sourced from outside CleanOps — BigQuery
 * today, any API or database later — shown read-only to the manager.
 *
 * A source is a name plus a reader. The first is Chekin Housing, the Chekin
 * property list landed in BigQuery by the gcp_chekin pipeline. Rows are read
 * whole and cached for a few minutes: the table is a few hundred properties,
 * and paging/search/sort happen in the browser, so a refresh is one query.
 */

export interface ControllingColumn { key: string; type: string }
export interface ControllingTable {
  source: string;
  label: string;
  origin: string;
  columns: ControllingColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  total: number;
  truncated: boolean;
  fetchedAt: string;
}

const MAX_ROWS = 20_000;
const CACHE_MS = 10 * 60_000;

const SOURCES: Record<string, { label: string; project: string; dataset: string; table: string }> = {
  'chekin-housing': {
    label: 'Chekin Housing',
    project: 'avantio-intergation',
    dataset: 'chekin_data',
    table: 'housing',
  },
};

/** The BigQuery data belongs to Airstay's tenant; other tenants never read it. */
const ALLOWED_TENANTS = (process.env.CONTROLLING_TENANT_SLUGS ?? 'prague-stays')
  .split(',').map((s) => s.trim()).filter(Boolean);

@Injectable()
export class ControllingService {
  private readonly logger = new Logger(ControllingService.name);
  private bq: BigQuery | null = null;
  private cache = new Map<string, ControllingTable>();

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return Object.entries(SOURCES).map(([key, s]) => ({
      key, label: s.label, origin: `BigQuery · ${s.project}.${s.dataset}.${s.table}`,
    }));
  }

  async read(tenantId: string, source: string, refresh = false): Promise<ControllingTable> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (!tenant || !ALLOWED_TENANTS.includes(tenant.slug)) {
      throw new ForbiddenException('Controlling is not enabled for this tenant');
    }
    const s = SOURCES[source];
    if (!s) throw new ForbiddenException('Unknown source');

    const hit = this.cache.get(source);
    if (!refresh && hit && Date.now() - Date.parse(hit.fetchedAt) < CACHE_MS) return hit;

    // Application Default Credentials, as staff-sync: GOOGLE_APPLICATION_CREDENTIALS in prod.
    this.bq ??= new BigQuery({ projectId: s.project });
    const table = this.bq.dataset(s.dataset, { projectId: s.project }).table(s.table);
    const [meta] = await table.getMetadata();
    const fields: Array<{ name: string; type: string }> = meta?.schema?.fields ?? [];
    const columns = fields.map((f) => ({ key: f.name, type: String(f.type ?? 'STRING') }));

    const [rows] = await this.bq.query({
      query: `SELECT * FROM \`${s.project}.${s.dataset}.${s.table}\` LIMIT ${MAX_ROWS + 1}`,
      location: meta?.location,
    });
    const truncated = rows.length > MAX_ROWS;
    const out: ControllingTable = {
      source,
      label: s.label,
      origin: `BigQuery · ${s.project}.${s.dataset}.${s.table}`,
      columns,
      rows: rows.slice(0, MAX_ROWS).map((r: Record<string, unknown>) => {
        const o: Record<string, string | number | boolean | null> = {};
        for (const c of columns) o[c.key] = plain(r[c.key]);
        return o;
      }),
      total: Math.min(rows.length, MAX_ROWS),
      truncated,
      fetchedAt: new Date().toISOString(),
    };
    this.cache.set(source, out);
    this.logger.log(`Controlling ${source}: ${out.total} rows, ${columns.length} columns`);
    return out;
  }
}

/** BigQuery hands back wrapper objects for dates, numerics and records; the table wants plain values. */
function plain(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (typeof v === 'object' && 'value' in (v as any) && Object.keys(v as any).length === 1) return plain((v as any).value);
  try { return JSON.stringify(v); } catch { return String(v); }
}
