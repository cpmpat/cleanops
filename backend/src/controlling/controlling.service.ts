import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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
  private serviceAccount: string | null = null;

  /** BigQuery with the app's service account (GCP_SERVICE_ACCOUNT_JSON), not ADC — ADC is not set on Railway. */
  private client(project: string): BigQuery {
    if (this.bq) return this.bq;
    const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new ServiceUnavailableException('GCP_SERVICE_ACCOUNT_JSON is not set — Controlling cannot read BigQuery.');
    let creds: { client_email: string; private_key: string };
    try { creds = JSON.parse(raw); } catch {
      throw new ServiceUnavailableException('GCP_SERVICE_ACCOUNT_JSON is not valid JSON — Controlling cannot read BigQuery.');
    }
    this.serviceAccount = creds.client_email ?? null;
    this.bq = new BigQuery({
      projectId: project,
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
    });
    return this.bq;
  }
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

    // The same service account the app already uses for Sheets and GCS
    // (GCP_SERVICE_ACCOUNT_JSON). It needs, in project avantio-intergation:
    // BigQuery Data Viewer (on dataset chekin_data or the project) and
    // BigQuery Job User (project) — the query runs as a job there.
    const bq = this.client(s.project);
    let meta: any;
    let rows: any[];
    try {
      [meta] = await bq.dataset(s.dataset, { projectId: s.project }).table(s.table).getMetadata();
      [rows] = await bq.query({
        query: `SELECT * FROM \`${s.project}.${s.dataset}.${s.table}\` LIMIT ${MAX_ROWS + 1}`,
        location: meta?.location,
      });
    } catch (err: any) {
      const code = err?.code ?? err?.response?.status;
      const msg = String(err?.message ?? err);
      this.logger.error(`Controlling ${source}: BigQuery ${code ?? ''} ${msg}`);
      const who = this.serviceAccount ?? 'the service account in GCP_SERVICE_ACCOUNT_JSON';
      if (code === 403 || /permission|denied|access/i.test(msg)) {
        throw new ServiceUnavailableException(
          `BigQuery refused ${who}. Grant it BigQuery Data Viewer on ${s.project}.${s.dataset} and BigQuery Job User on project ${s.project}.`,
        );
      }
      if (code === 404 || /not found/i.test(msg)) {
        throw new ServiceUnavailableException(`BigQuery table ${s.project}.${s.dataset}.${s.table} not found (or not visible to ${who}).`);
      }
      throw new ServiceUnavailableException(`BigQuery error: ${msg.slice(0, 300)}`);
    }
    const fields: Array<{ name: string; type: string }> = meta?.schema?.fields ?? [];
    const columns = fields.map((f) => ({ key: f.name, type: String(f.type ?? 'STRING') }));
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
