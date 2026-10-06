import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { DB_MODELS, TABS } from './datasets.service';

/**
 * Notifications → Data: who changed what in the CDM lists, when, from what to
 * what — app saves and sheet reloads alike (both write dataset_field_changes).
 *
 * What a role sees is the intersection of two matrices, per list and field:
 * the notify matrix (dataset_field_notify) says which changes it is told
 * about, the access matrix (dataset_field_access) whether it may see the field
 * at all. Notify can only narrow; a role is never shown a change to a field it
 * could not open in Data. Sensitive fields are recorded without values, and —
 * as in the record drawer's history — only ADMIN sees that they changed.
 */

/** Columns that name a record, tried in order. */
const TITLE_FIELDS = ['titleAvantio', 'displayName', 'nickname', 'name', 'lastName', 'idAvantio', 'internalId', 'id'];

export interface FeedQuery {
  dataset?: string;
  field?: string;
  actor?: string;
  source?: 'app' | 'import';
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

const IMPORT_ROLE = 'IMPORT';

@Injectable()
export class DataNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** list → fields this role is shown changes of. */
  private async scope(tenantId: string, role: UserRole): Promise<Map<string, Set<string>>> {
    const [notify, view] = await Promise.all([
      this.prisma.datasetFieldNotify.findMany({
        where: { tenantId, role, notify: true },
        select: { dataset: true, field: true },
      }),
      this.prisma.datasetFieldAccess.findMany({
        where: { tenantId, role, canView: true },
        select: { dataset: true, field: true },
      }),
    ]);
    const viewable = new Set(view.map((v) => `${v.dataset}:${v.field}`));
    const out = new Map<string, Set<string>>();
    for (const n of notify) {
      if (!viewable.has(`${n.dataset}:${n.field}`)) continue;
      if (!out.has(n.dataset)) out.set(n.dataset, new Set());
      out.get(n.dataset)!.add(n.field);
    }
    return out;
  }

  /** The lists and fields the filters may offer this role, with labels. */
  async meta(tenantId: string, role: UserRole) {
    const scope = await this.scope(tenantId, role);
    const labels = await this.prisma.datasetField.findMany({
      where: { tenantId, dataset: { in: [...scope.keys()] } },
      select: { dataset: true, field: true, displayName: true, columnOrder: true },
      orderBy: { columnOrder: 'asc' },
    });
    return {
      lists: TABS.filter((t) => scope.has(t.key)).map((t) => {
        const fields = scope.get(t.key)!;
        const described = labels.filter((l) => l.dataset === t.key && fields.has(l.field));
        const rest = [...fields].filter((f) => !described.some((d) => d.field === f)).sort();
        return {
          key: t.key,
          label: t.label,
          fields: [
            ...described.map((d) => ({ key: d.field, label: d.displayName || d.field })),
            ...rest.map((f) => ({ key: f, label: f })),
          ],
        };
      }),
    };
  }

  async feed(tenantId: string, role: UserRole, q: FeedQuery) {
    const scope = await this.scope(tenantId, role);
    let pairs = [...scope];
    if (q.dataset) pairs = pairs.filter(([d]) => d === q.dataset);
    if (q.field) {
      pairs = pairs
        .map(([d, fs]) => [d, new Set([...fs].filter((f) => f === q.field))] as [string, Set<string>])
        .filter(([, fs]) => fs.size > 0);
    }
    if (pairs.length === 0) return { items: [], next: null };

    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from && !isNaN(Date.parse(q.from))) createdAt.gte = new Date(q.from);
    // `to` is a day; include all of it.
    if (q.to && !isNaN(Date.parse(q.to))) createdAt.lt = new Date(new Date(q.to).getTime() + 86_400_000);

    const where: Prisma.DatasetFieldChangeWhereInput = {
      tenantId,
      OR: pairs.map(([dataset, fs]) => ({ dataset, field: { in: [...fs] } })),
      ...(role === 'ADMIN' ? {} : { masked: false }),
      ...(q.actor ? { actorEmail: { contains: q.actor.trim(), mode: 'insensitive' as const } } : {}),
      ...(q.source === 'import' ? { actorRole: IMPORT_ROLE } : {}),
      ...(q.source === 'app' ? { NOT: { actorRole: IMPORT_ROLE } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };

    const rows = await this.prisma.datasetFieldChange.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true, dataset: true, rowId: true, field: true, oldValue: true, newValue: true,
        masked: true, actorEmail: true, actorRole: true, createdAt: true,
      },
    });
    const page = rows.slice(0, limit);
    const next = rows.length > limit ? page[page.length - 1].id : null;

    const [titles, labels] = await Promise.all([this.titles(tenantId, page), this.fieldLabels(tenantId, page)]);
    return {
      items: page.map((r) => ({
        ...r,
        listLabel: TABS.find((t) => t.key === r.dataset)?.label ?? r.dataset,
        fieldLabel: labels.get(`${r.dataset}:${r.field}`) ?? r.field,
        record: titles.get(`${r.dataset}:${r.rowId}`) ?? null,
        source: r.actorRole === IMPORT_ROLE ? 'import' : 'app',
      })),
      next,
    };
  }

  private async fieldLabels(tenantId: string, page: Array<{ dataset: string; field: string }>) {
    const out = new Map<string, string>();
    if (!page.length) return out;
    const rows = await this.prisma.datasetField.findMany({
      where: { tenantId, OR: [...new Set(page.map((p) => p.dataset))].map((d) => ({ dataset: d, field: { in: page.filter((p) => p.dataset === d).map((p) => p.field) } })) },
      select: { dataset: true, field: true, displayName: true },
    });
    for (const r of rows) out.set(`${r.dataset}:${r.field}`, r.displayName || r.field);
    return out;
  }

  /** A readable name for each changed record — its title, else its key. */
  private async titles(tenantId: string, page: Array<{ dataset: string; rowId: string }>) {
    const out = new Map<string, string>();
    for (const dataset of new Set(page.map((p) => p.dataset))) {
      const spec = DB_MODELS[dataset];
      if (!spec) continue;
      const modelName = spec.model.charAt(0).toUpperCase() + spec.model.slice(1);
      const fields = new Set(
        Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)?.fields.map((f) => f.name) ?? [],
      );
      const titleFields = TITLE_FIELDS.filter((f) => fields.has(f));
      const ids = [...new Set(page.filter((p) => p.dataset === dataset).map((p) => p.rowId))];
      const select: Record<string, true> = { [spec.pk]: true, [spec.key]: true };
      for (const f of titleFields) select[f] = true;
      const rows: Array<Record<string, unknown>> = await (this.prisma as any)[spec.model].findMany({
        where: { tenantId, [spec.pk]: { in: ids } },
        select,
      });
      for (const r of rows) {
        const title = titleFields.map((f) => r[f]).find((v) => v !== null && v !== undefined && String(v).trim() !== '');
        const key = r[spec.key];
        const label = title !== undefined && String(title) !== String(key) && key != null
          ? `${title} (${key})`
          : String(title ?? key ?? '');
        out.set(`${dataset}:${String(r[spec.pk])}`, label);
      }
    }
    return out;
  }
}
