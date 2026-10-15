// backend/src/datasets/oxpoint-lookup.ts
//
// Accommodation's OX Point columns (sheet FW–GF) are a lookup, not data:
// accommodation.oxPointId names a row of cdm_ox_point by its four-character
// code (`id`, the list's own key — e.g. ITS4), and these columns copy that row. They change in two ways only:
//
//  * someone picks another oxPointId on an accommodation → that row is
//    re-read (DatasetsService.update);
//  * someone edits an OX Point → every accommodation pointing at it is
//    re-synced (DatasetsService.update → syncOxLookups);
//
// plus `refresh:oxpoint-lookups` for a sheet reload of either list. Nobody
// edits them by hand: access is view-only for every role, MANAGER included.

/**
 * The cdm_ox_point column accommodation.oxPointId holds: `id`, the point's
 * four-character code and the list's key. (Not `oxId`, the sheet's "ID"
 * column — the first refresh matched 0 of 42 that way, 15 Oct 2026.)
 */
export const OX_LOOKUP_KEY = 'id';

/** Accommodation column → the cdm_ox_point column it copies. */
export const OX_LOOKUP: Readonly<Record<string, string>> = {
  oxpointCity: 'city',
  oxpointDistrict: 'district',
  oxpointStreet: 'street',
  oxpointStreetnumber: 'streetNumber',
  oxpointPostcode: 'postCode',
  oxpointDescription: 'description',
  oxpointBoxnumber: 'boxNumber',
  oxpointAccesscode: 'accessCode',
  oxpointLockboxnumber: 'lockBoxNumber',
  oxpointLockboxcode: 'lockboxCode',
  oxpointAccessibilitysummary: 'accessibilitySummary',
};

export const OX_LOOKUP_FIELDS = Object.keys(OX_LOOKUP);

/** OX Point columns whose change must reach the accommodations using it. */
export const OX_SOURCE_FIELDS = new Set([OX_LOOKUP_KEY, ...Object.values(OX_LOOKUP)]);

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const pointSelect = () =>
  Object.fromEntries([OX_LOOKUP_KEY, ...Object.values(OX_LOOKUP)].map((f) => [f, true]));

/** The ten values for one oxPointId; all null when it is empty or matches no point. */
export async function oxLookupValues(
  db: any,
  tenantId: string,
  oxPointId: string | null | undefined,
): Promise<{ values: Record<string, string | null>; matched: boolean }> {
  const empty = Object.fromEntries(OX_LOOKUP_FIELDS.map((f) => [f, null]));
  const id = text(oxPointId);
  if (!id) return { values: empty, matched: true };
  const point = await db.cdmOxPoint.findFirst({
    where: { tenantId, [OX_LOOKUP_KEY]: { equals: id, mode: 'insensitive' } },
    select: pointSelect(),
  });
  if (!point) return { values: empty, matched: false };
  return {
    values: Object.fromEntries(Object.entries(OX_LOOKUP).map(([acc, src]) => [acc, text(point[src])])),
    matched: true,
  };
}

export interface OxSyncReport {
  checked: number;
  changedRows: number;
  changedCells: number;
  byField: Record<string, number>;
  /** Accommodations whose oxPointId matches no OX Point: left as they are. */
  unmatched: Array<{ idAvantio: string | null; oxPointId: string }>;
}

/**
 * Bring accommodations' OX Point columns in line with cdm_ox_point. Every
 * change is recorded like an app edit (one audit event, a change row per
 * cell; access and lockbox codes without values). An oxPointId that matches no
 * point is reported and left alone — never blanked on a guess.
 */
export async function syncOxLookups(
  db: any,
  tenantId: string,
  opts: {
    apply: boolean;
    /** Narrow to some accommodations (Prisma where); default all. */
    where?: Record<string, unknown>;
    actorId?: string | null;
    actorEmail: string | null;
    actorRole: string;
    action: string;
  },
): Promise<OxSyncReport> {
  const points: Array<Record<string, unknown>> = await db.cdmOxPoint.findMany({
    where: { tenantId },
    select: pointSelect(),
  });
  const byKey = new Map<string, Record<string, unknown>>();
  for (const p of points) {
    const k = text(p[OX_LOOKUP_KEY]);
    if (k) byKey.set(k.toLowerCase(), p);
  }

  const accs: Array<Record<string, unknown>> = await db.cdmAccommodation.findMany({
    where: { tenantId, ...(opts.where ?? {}) },
    select: {
      rowId: true, idAvantio: true, oxPointId: true,
      ...Object.fromEntries(OX_LOOKUP_FIELDS.map((f) => [f, true])),
    },
  });

  const report: OxSyncReport = { checked: accs.length, changedRows: 0, changedCells: 0, byField: {}, unmatched: [] };
  const sensitive = new Set<string>(
    (await db.datasetField.findMany({
      where: { tenantId, dataset: 'accommodation', field: { in: OX_LOOKUP_FIELDS }, sensitive: true },
      select: { field: true },
    })).map((f: { field: string }) => f.field),
  );
  let eventId: string | null = null;
  let eventAt: Date | null = null;

  for (const a of accs) {
    const id = text(a.oxPointId);
    let expected: Record<string, string | null>;
    if (!id) {
      expected = Object.fromEntries(OX_LOOKUP_FIELDS.map((f) => [f, null]));
    } else {
      const p = byKey.get(id.toLowerCase());
      if (!p) {
        report.unmatched.push({ idAvantio: text(a.idAvantio), oxPointId: id });
        continue;
      }
      expected = Object.fromEntries(Object.entries(OX_LOOKUP).map(([acc, src]) => [acc, text(p[src])]));
    }
    const diff = OX_LOOKUP_FIELDS.filter((f) => text(a[f]) !== expected[f]);
    if (diff.length === 0) continue;

    report.changedRows++;
    report.changedCells += diff.length;
    for (const f of diff) report.byField[f] = (report.byField[f] ?? 0) + 1;
    if (!opts.apply) continue;

    if (!eventId) {
      const event = await db.auditEvent.create({
        data: {
          tenantId,
          category: 'DATA_EDIT',
          action: opts.action,
          actorId: opts.actorId ?? null,
          actorEmail: opts.actorEmail,
          targetType: 'dataset:accommodation',
          targetId: null,
          metadata: { fields: OX_LOOKUP_FIELDS },
        },
      });
      eventId = event.id;
      eventAt = event.createdAt;
    }
    await db.cdmAccommodation.update({
      where: { rowId: a.rowId },
      data: Object.fromEntries(diff.map((f) => [f, expected[f]])),
    });
    await db.datasetFieldChange.createMany({
      data: diff.map((f) => {
        const masked = sensitive.has(f);
        return {
          tenantId,
          eventId,
          dataset: 'accommodation',
          rowId: a.rowId,
          field: f,
          oldValue: masked ? null : text(a[f]),
          newValue: masked ? null : expected[f],
          masked,
          actorEmail: opts.actorEmail,
          actorRole: opts.actorRole,
          createdAt: eventAt,
        };
      }),
    });
  }
  return report;
}
