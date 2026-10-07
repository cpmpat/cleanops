import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { DB_MODELS, TABS } from '../datasets/datasets.service';
import { NEWS_RULES, NEWSFEED_DAYS, NewsPart, NewsRule, plain } from './rules';

const IMPORT_ROLE = 'IMPORT';
const TITLE_FIELDS = ['titleAvantio', 'displayName', 'nickname', 'name', 'lastName'];

export interface NewsItem {
  id: string;
  rule: string;
  createdAt: Date;
  /** The record's name, shown as the reference. */
  title: string;
  ref: { dataset: string; list: string; rowId: string; key: string | null };
  /** The sentence in pieces (bold date, channel logos) … */
  parts: NewsPart[];
  /** … and as plain text. */
  text: string;
  source: 'app' | 'import';
  actorEmail: string | null;
  dismissed: boolean;
}

@Injectable()
export class NewsfeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rules this role may see: it must be allowed to view the field the news is about. */
  private async rulesFor(tenantId: string, role: UserRole): Promise<NewsRule[]> {
    const grants = await this.prisma.datasetFieldAccess.findMany({
      where: { tenantId, role, canView: true, dataset: { in: [...new Set(NEWS_RULES.map((r) => r.dataset))] } },
      select: { dataset: true, field: true },
    });
    const can = new Set(grants.map((g) => `${g.dataset}:${g.field}`));
    return NEWS_RULES.filter((r) => can.has(`${r.dataset}:${r.field}`));
  }

  private async rowFilter(tenantId: string, dataset: string, role: UserRole) {
    const filters = await this.prisma.datasetRowFilter.findMany({ where: { tenantId, dataset, role } });
    return filters.length ? { AND: filters.map((f) => ({ [f.field]: { in: f.values } })) } : {};
  }

  /** Every current news item for this person, newest first. */
  async items(tenantId: string, userId: string, role: UserRole): Promise<NewsItem[]> {
    const rules = await this.rulesFor(tenantId, role);
    if (!rules.length) return [];
    const since = new Date(Date.now() - NEWSFEED_DAYS * 86_400_000);

    const changes = await this.prisma.datasetFieldChange.findMany({
      where: {
        tenantId,
        createdAt: { gte: since },
        masked: false,
        OR: rules.map((r) => ({ dataset: r.dataset, field: r.field })),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, dataset: true, rowId: true, field: true, newValue: true, actorEmail: true, actorRole: true, createdAt: true },
    });

    // Latest change per record and field; a cleared value means no news.
    const seen = new Set<string>();
    const latest = changes.filter((c) => {
      const k = `${c.dataset}:${c.rowId}:${c.field}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return !!c.newValue && c.newValue.trim() !== '';
    });
    if (!latest.length) return [];

    // The records, read once per list, with what the sentences need.
    const rows = new Map<string, Record<string, unknown>>();
    for (const dataset of new Set(latest.map((c) => c.dataset))) {
      const spec = DB_MODELS[dataset];
      if (!spec) continue;
      const modelName = spec.model.charAt(0).toUpperCase() + spec.model.slice(1);
      const has = new Set(Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)?.fields.map((f) => f.name) ?? []);
      const select: Record<string, true> = { [spec.pk]: true, [spec.key]: true };
      for (const f of [...TITLE_FIELDS, ...rules.filter((r) => r.dataset === dataset).flatMap((r) => r.needs)]) {
        if (has.has(f)) select[f] = true;
      }
      const found: Array<Record<string, unknown>> = await (this.prisma as any)[spec.model].findMany({
        where: {
          tenantId,
          [spec.pk]: { in: [...new Set(latest.filter((c) => c.dataset === dataset).map((c) => c.rowId))] },
          ...(await this.rowFilter(tenantId, dataset, role)),
        },
        select,
      });
      for (const r of found) rows.set(`${dataset}:${String(r[spec.pk])}`, r);
    }

    const dismissed = new Set(
      (await this.prisma.newsfeedDismissal.findMany({
        where: { userId, itemId: { in: latest.map((c) => c.id) } },
        select: { itemId: true },
      })).map((d) => d.itemId),
    );

    const out: NewsItem[] = [];
    for (const c of latest) {
      const rule = rules.find((r) => r.dataset === c.dataset && r.field === c.field)!;
      const row = rows.get(`${c.dataset}:${c.rowId}`);
      if (!row) continue; // deleted, or outside this role's rows
      const parts = rule.parts(c.newValue!, row);
      if (!parts) continue;
      const spec = DB_MODELS[c.dataset];
      const key = row[spec.key] == null ? null : String(row[spec.key]);
      const title = TITLE_FIELDS.map((f) => row[f]).find((v) => v != null && String(v).trim() !== '');
      out.push({
        id: c.id,
        rule: rule.key,
        createdAt: c.createdAt,
        title: String(title ?? key ?? c.rowId),
        ref: { dataset: c.dataset, list: TABS.find((t) => t.key === c.dataset)?.label ?? c.dataset, rowId: c.rowId, key },
        parts,
        text: plain(parts),
        source: c.actorRole === IMPORT_ROLE ? 'import' : 'app',
        // Who made the change in the app. A sheet reload has no editor to name.
        actorEmail: c.actorRole === IMPORT_ROLE ? null : c.actorEmail,
        dismissed: dismissed.has(c.id),
      });
    }
    return out;
  }

  async feed(tenantId: string, userId: string, role: UserRole, all: boolean) {
    const items = await this.items(tenantId, userId, role);
    return {
      items: all ? items : items.filter((i) => !i.dismissed),
      unread: items.filter((i) => !i.dismissed).length,
    };
  }

  async unread(tenantId: string, userId: string, role: UserRole) {
    return { count: (await this.items(tenantId, userId, role)).filter((i) => !i.dismissed).length };
  }

  async dismiss(tenantId: string, userId: string, itemId: string) {
    const exists = await this.prisma.datasetFieldChange.count({ where: { id: itemId, tenantId } });
    if (!exists) throw new NotFoundException('No such news item');
    await this.prisma.newsfeedDismissal.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { tenantId, userId, itemId },
      update: {},
    });
    return { ok: true };
  }

  async dismissAll(tenantId: string, userId: string, role: UserRole) {
    const open = (await this.items(tenantId, userId, role)).filter((i) => !i.dismissed);
    if (open.length) {
      await this.prisma.newsfeedDismissal.createMany({
        data: open.map((i) => ({ tenantId, userId, itemId: i.id })),
        skipDuplicates: true,
      });
    }
    return { dismissed: open.length };
  }
}
