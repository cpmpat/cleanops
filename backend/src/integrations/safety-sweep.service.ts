// backend/src/integrations/safety-sweep.service.ts
//
// The nightly safety sweep: the net under the 30-minute Avantio sync.
//
//   1. Missed bookings. Ask Avantio for every booking updated in the last
//      `windowDays`, and sync the ones that have no Booking row here. The
//      30-minute sync misses a few when Avantio's own :00/:30 job races it
//      (7 missed between 13 and 15 Sep).
//   2. Turnover chain. Run the reconcile over bookings arriving in the same
//      window: create missing turnovers, re-thread stale ones, revive the
//      reconcile's own orphan-cancels the bookings justify again. Since PR #61
//      it never cancels a turnover whose bookings are CONFIRMED.
//   3. Ghost bookings. An IMPOSSIBLE_WINDOW (two CONFIRMED bookings holding a
//      unit at once) is almost always a cancellation Avantio never sent us.
//      Re-fetch both bookings by id — the runbook's manual fix — and, if that
//      changed anything, reconcile those units again.
//   4. One audit row per tenant per night (action 'sweep.completed' or
//      'sweep.failed', actor safety-sweep@cleanops) with what was fixed and
//      what needs a person, plus log lines. There is no UI on purpose.
//
// Notifications are left ON: a booking the sync missed is a booking staff
// should have heard about, and runWithoutNotifications() cannot be used in the
// server process anyway. A dry run (apply=false) writes nothing at all, not
// even the audit row.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { BookingSyncService, BookingSyncOutcome } from './booking-sync.service';
import { TurnoverReconcileService, ReconcileReport } from './turnover-reconcile.service';

export const SWEEP_ACTOR = 'safety-sweep@cleanops';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Cap on items stored in the audit row; the counts are always complete. */
const MAX_ITEMS = 200;

export interface SweepOptions {
  tenantId: string;
  apply: boolean;
  windowDays?: number;
}

export interface SweepResult {
  tenantId: string;
  tenantName: string;
  apply: boolean;
  windowDays: number;
  startedAt: string;
  durationMs: number;
  bookings: {
    listedByPms: number;
    missingLocally: number;
    outcomes: Record<BookingSyncOutcome['result'], number>;
    /** Why the skipped ones were skipped, counted over all of them. */
    skipReasons: Record<string, number>;
    items: BookingSyncOutcome[];
  };
  /** Bookings behind IMPOSSIBLE_WINDOW items, re-fetched from Avantio. */
  overlaps: {
    refetched: number;
    outcomes: BookingSyncOutcome[];
    stillOverlapping: number;
  };
  turnovers:
    | { skipped: string }
    | {
        propertiesScanned: number;
        propertiesWithDrift: number;
        counts: ReconcileReport['counts'];
        applied: number;
        needsReview: number;
        verifyFailures: string[];
        errors: ReconcileReport['errors'];
        items: Array<{
          kind: string;
          property: string;
          turnoverId?: string;
          detail: string;
          action: string;
          applied: boolean;
          needsReview: boolean;
        }>;
      };
  /** Set when a step threw; the steps before it still count. */
  error?: string;
}

@Injectable()
export class SafetySweepService {
  private readonly logger = new Logger(SafetySweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingSync: BookingSyncService,
    private readonly reconcile: TurnoverReconcileService,
  ) {}

  async sweepTenant(opts: SweepOptions): Promise<SweepResult> {
    const windowDays = opts.windowDays ?? 7;
    const started = Date.now();
    const since = new Date(started - windowDays * DAY_MS);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: opts.tenantId },
      select: { id: true, name: true },
    });

    const result: SweepResult = {
      tenantId: tenant.id,
      tenantName: tenant.name,
      apply: opts.apply,
      windowDays,
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
      bookings: {
        listedByPms: 0,
        missingLocally: 0,
        outcomes: { created: 0, updated: 0, cancelled: 0, skipped: 0, error: 0 },
        skipReasons: {},
        items: [],
      },
      turnovers: { skipped: 'not run' },
      overlaps: { refetched: 0, outcomes: [], stillOverlapping: 0 },
    };

    try {
      // ── 1. Bookings Avantio has and we don't ──
      const { adapter, config } = await this.bookingSync.getTenantSyncContext(tenant.id);
      const listed = [...new Set(await adapter.listBookingIdsUpdatedSince(since, config))];
      const missing = await this.bookingSync.findMissingPmsBookingIds(tenant.id, listed);
      result.bookings.listedByPms = listed.length;
      result.bookings.missingLocally = missing.length;

      if (missing.length) {
        const outcomes = opts.apply
          ? await this.bookingSync.syncBookingsByPmsIds(tenant.id, missing, { concurrency: 3 })
          : await this.bookingSync.previewBookingsByPmsIds(tenant.id, missing, { concurrency: 3 });
        for (const o of outcomes) {
          result.bookings.outcomes[o.result]++;
          if (o.result === 'skipped') {
            // Ids and refs make every reason unique; count the shape.
            const reason = (o.detail ?? 'no reason given').replace(/\b[A-Z0-9-]*\d[A-Z0-9-]*\b/g, '#');
            result.bookings.skipReasons[reason] = (result.bookings.skipReasons[reason] ?? 0) + 1;
          }
        }
        result.bookings.items = outcomes.slice(0, MAX_ITEMS);
      }

      // ── 2. Turnover chain, after the bookings are in ──
      if (process.env.TURNOVER_SYNC_ENABLED !== 'true') {
        result.turnovers = { skipped: 'TURNOVER_SYNC_ENABLED is not true' };
      } else {
        let report = await this.reconcile.reconcileTenant({
          tenantId: tenant.id,
          fromDate: since,
          apply: opts.apply,
          verify: opts.apply,
        });

        // ── 3. Overlapping bookings: re-fetch them, re-reconcile if changed ──
        const overlaps = report.drift.filter((d) => d.kind === 'IMPOSSIBLE_WINDOW');
        const overlapBookingIds = [...new Set(overlaps.flatMap((d) => d.bookingIds ?? []))];
        if (overlapBookingIds.length) {
          const rows = await this.prisma.booking.findMany({
            where: { id: { in: overlapBookingIds }, pmsBookingId: { not: null } },
            select: { pmsBookingId: true },
          });
          const pmsIds = rows.map((r) => r.pmsBookingId!).filter(Boolean);
          const outcomes = pmsIds.length
            ? opts.apply
              ? await this.bookingSync.syncBookingsByPmsIds(tenant.id, pmsIds, { concurrency: 3 })
              : await this.bookingSync.previewBookingsByPmsIds(tenant.id, pmsIds, { concurrency: 3 })
            : [];
          result.overlaps = { refetched: pmsIds.length, outcomes, stillOverlapping: overlaps.length };

          const changed = outcomes.some((o) => o.result === 'cancelled' || o.result === 'updated');
          if (opts.apply && changed) {
            const propertyIds = [...new Set(overlaps.map((d) => d.propertyId))];
            const again = await this.reconcile.reconcileTenant({
              tenantId: tenant.id,
              propertyIds,
              fromDate: since,
              apply: true,
              verify: true,
            });
            result.overlaps.stillOverlapping = again.counts.IMPOSSIBLE_WINDOW;
            // Report the second pass for those units in place of the first.
            report = {
              ...report,
              drift: [
                ...report.drift.filter((d) => !propertyIds.includes(d.propertyId)),
                ...again.drift,
              ],
              appliedCount: report.appliedCount + again.appliedCount,
              needsReviewCount:
                report.needsReviewCount -
                report.drift.filter((d) => d.needsReview && propertyIds.includes(d.propertyId)).length +
                again.needsReviewCount,
              verifyFailures: [...report.verifyFailures, ...again.verifyFailures],
              errors: [...report.errors, ...again.errors],
            };
            for (const k of Object.keys(report.counts) as (keyof typeof report.counts)[]) {
              report.counts[k] = report.drift.filter((d) => d.kind === k).length;
            }
          }
        }

        result.turnovers = {
          propertiesScanned: report.propertiesScanned,
          propertiesWithDrift: report.propertiesWithDrift,
          counts: report.counts,
          applied: report.appliedCount,
          needsReview: report.needsReviewCount,
          verifyFailures: report.verifyFailures,
          errors: report.errors,
          items: report.drift.slice(0, MAX_ITEMS).map((d) => ({
            kind: d.kind,
            property: d.propertyName,
            turnoverId: d.turnoverId,
            detail: d.detail,
            action: d.action,
            applied: d.applied,
            needsReview: d.needsReview,
          })),
        };
      }
    } catch (err) {
      result.error = (err as Error).message;
    }

    result.durationMs = Date.now() - started;
    this.log(result);

    if (opts.apply) {
      try {
        await this.prisma.auditEvent.create({
          data: {
            tenantId: tenant.id,
            category: 'SYSTEM',
            action: result.error ? 'sweep.failed' : 'sweep.completed',
            actorId: null,
            actorEmail: SWEEP_ACTOR,
            targetType: 'Tenant',
            targetId: tenant.id,
            metadata: result as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        this.logger.error(`[${tenant.name}] could not write the sweep audit row: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private log(r: SweepResult): void {
    const tag = `[sweep ${r.tenantName}${r.apply ? '' : ' DRY RUN'}]`;
    const b = r.bookings;
    this.logger.log(
      `${tag} bookings: ${b.listedByPms} updated in ${r.windowDays}d at Avantio, ` +
      `${b.missingLocally} missing here → created ${b.outcomes.created}, ` +
      `skipped ${b.outcomes.skipped}, errors ${b.outcomes.error}`,
    );
    for (const [reason, n] of Object.entries(b.skipReasons).sort((x, y) => y[1] - x[1])) {
      this.logger.log(`${tag}   skipped ${n}× ${reason}`);
    }
    for (const o of b.items) {
      if (o.result !== 'skipped') this.logger.log(`${tag}   booking ${o.pmsBookingId}: ${o.result}${o.detail ? ` — ${o.detail}` : ''}`);
    }
    if (r.overlaps.refetched) {
      this.logger.log(
        `${tag} overlaps: re-fetched ${r.overlaps.refetched} booking(s) from Avantio, ` +
        `${r.overlaps.stillOverlapping} overlap(s) left`,
      );
      for (const o of r.overlaps.outcomes) {
        this.logger.log(`${tag}   booking ${o.pmsBookingId}: ${o.result}${o.detail ? ` — ${o.detail}` : ''}`);
      }
    }
    const t = r.turnovers;
    if ('skipped' in t) {
      this.logger.warn(`${tag} turnovers: skipped (${t.skipped})`);
    } else {
      this.logger.log(
        `${tag} turnovers: ${t.propertiesScanned} units, ${t.propertiesWithDrift} with drift, ` +
        `${t.applied} fixed, ${t.needsReview} need review`,
      );
      for (const i of t.items) {
        const what = i.needsReview ? 'REVIEW' : i.applied ? 'fixed' : 'would fix';
        const line = `${tag}   ${what} ${i.kind} ${i.property}: ${i.detail} → ${i.action}`;
        if (i.needsReview) this.logger.warn(line);
        else this.logger.log(line);
      }
      for (const v of t.verifyFailures) this.logger.error(`${tag}   verify failed: ${v}`);
      for (const e of t.errors) this.logger.error(`${tag}   ${e.propertyName}: ${e.message}`);
    }
    if (r.error) this.logger.error(`${tag} stopped: ${r.error}`);
    this.logger.log(`${tag} done in ${Math.round(r.durationMs / 1000)}s`);
  }
}
