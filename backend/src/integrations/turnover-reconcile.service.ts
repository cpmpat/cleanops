// backend/src/integrations/turnover-reconcile.service.ts
//
// Chain-integrity reconciler for the Turnover model.
//
// WHY THIS EXISTS
// ---------------
// TurnoverSyncService is purely reactive: it only runs from an
// onBookingInserted / onBookingCancelled / onBookingModified event, and every
// one of those calls is wrapped in BookingSyncService.safelyRunTurnoverSync(),
// which logs and SWALLOWS errors. A single failure leaves the chain broken
// forever with no retry and no detector. On top of that, the whole dual-write
// is gated behind TURNOVER_SYNC_ENABLED, so any booking synced while the flag
// was off has no turnover row at all — while the cleaner app reads turnovers.
//
// This service is the detector and the repair tool. It derives the chain that
// SHOULD exist from the bookings table (the source of truth) and reports or
// fixes every difference.
//
// THE INVARIANT
// -------------
// For each property, take its CONFIRMED bookings ordered by checkInTime:
//
//   B1 ... Bn   =>   (null -> B1), (B1 -> B2), ..., (Bn-1 -> Bn), (Bn -> null)
//
//   availableFrom = from.checkOutTime   (null for the leading slot)
//   dueBy         = to.checkInTime      (null for the trailing slot)
//   isOwnerStay   = to.isOwnerStay      (false for the trailing slot)
//
// Exactly one live turnover should exist per slot, where "live" is the same
// predicate the read path uses (TurnoversService):
//
//   supersededById IS NULL AND status NOT IN ('CANCELLED', 'SKIPPED')
//
// SAFETY RULES (non-negotiable)
// -----------------------------
//  * Never DELETE. Never UPDATE endpoints in place. All endpoint changes go
//    through TurnoverSyncService.supersede(), which carries assignments,
//    status, notes and timestamps onto the fresh row.
//  * Never resurrect a slot a human closed. A slot covered by a CANCELLED
//    turnover, or by a SKIPPED turnover that is not a system merge, is left
//    exactly as it is.
//  * Never auto-retire a turnover that is IN_PROGRESS / COMPLETED / FLAGGED or
//    that carries assignments. Those get reported as needsReview instead.
//  * Dry run is the default. The caller has to ask for writes.
//  * Idempotent: a second pass over the same data must find nothing.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Booking, Turnover, TurnoverStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { TurnoverSyncService } from './turnover-sync.service';
import { timeInAppZone } from '../common/time';

type Tx = Prisma.TransactionClient;

/** Statuses the read path treats as live work. */
const LIVE_STATUSES: TurnoverStatus[] = [
  TurnoverStatus.PENDING,
  TurnoverStatus.ASSIGNED,
  TurnoverStatus.IN_PROGRESS,
  TurnoverStatus.COMPLETED,
  TurnoverStatus.FLAGGED,
];

/** Statuses that represent real human work — never auto-retired. */
const PROTECTED_STATUSES: TurnoverStatus[] = [
  TurnoverStatus.IN_PROGRESS,
  TurnoverStatus.COMPLETED,
  TurnoverStatus.FLAGGED,
];

/**
 * Mirrors POOL_STALE_CUTOFF_DAYS in TurnoversService: the pool only offers
 * turnovers whose availableFrom is within this many days of now. An orphan
 * older than that cannot be claimed, so cleaning it up buys nothing and only
 * rewrites history.
 *
 * Note this bounds the POOL, not every view — a cleaner browsing to a past
 * month in the calendar can still see an older orphan. Raise the window if you
 * want those gone too.
 */
const POOL_VISIBILITY_DAYS = 2;

/**
 * Which of several competing live turnovers for one slot to keep.
 * Higher wins. Ties break on "has assignments", then on oldest createdAt.
 */
const STATUS_RANK: Record<TurnoverStatus, number> = {
  COMPLETED: 5,
  IN_PROGRESS: 4,
  FLAGGED: 3,
  ASSIGNED: 2,
  PENDING: 1,
  CANCELLED: 0,
  SKIPPED: 0,
};

export type DriftKind =
  | 'MISSING'           // slot exists in bookings, no live turnover for it
  | 'TIME_DRIFT'        // right endpoints, wrong availableFrom / dueBy / isOwnerStay
  | 'STALE_ENDPOINT'    // live turnover points at the wrong neighbour
  | 'DUPLICATE_ACTIVE'  // two or more live turnovers claim the same slot/endpoint
  | 'ORPHAN'            // live turnover matches no slot at all
  | 'IMPOSSIBLE_WINDOW' // slot ends before it begins — the bookings overlap
  | 'LEGACY_MERGE'      // SKIPPED-by-merge row still active (pre-fix rows)
  | 'CHAIN_CYCLE';      // supersededById points at itself / forms a loop

export interface DriftItem {
  kind: DriftKind;
  propertyId: string;
  propertyName: string;
  turnoverId?: string;
  /** Human-readable statement of what is wrong. */
  detail: string;
  /** What the reconciler did, or would do with --apply. */
  action: string;
  /** True when a human has to look at this — never auto-fixed. */
  needsReview: boolean;
  applied: boolean;
}

export interface ReconcileOptions {
  tenantId: string;
  /** Internal Property.id values. Empty/undefined = every property. */
  propertyIds?: string[];
  /**
   * Only consider bookings arriving at or after this instant. The booking
   * immediately before the window is still loaded as an anchor so the first
   * in-window slot gets its real predecessor. null = all history.
   */
  fromDate: Date | null;
  /** Defaults to false: report only. */
  apply?: boolean;
  /**
   * A SKIPPED row with skipReason NULL predates the skipReason column.
   * Defaults to true, which treats it as a possible human decision and leaves
   * it alone.
   */
  respectUnknownSkips?: boolean;
  /** Re-run detection after applying and report anything left over. */
  verify?: boolean;
  /**
   * Only auto-cancel an orphan whose carry-forward date
   * (availableFrom ?? dueBy ?? createdAt) is within this many days of now —
   * i.e. one a cleaner could still act on. Older orphans are counted and
   * disclosed in `excluded`, but left in place.
   *
   * Defaults to POOL_VISIBILITY_DAYS. Pass a very large number to clear every
   * orphan regardless of age.
   */
  orphanVisibilityDays?: number;
  /**
   * Called once per property, before its transaction runs. Scripts boot this
   * service with the Nest logger quieted, so without a hook the whole run is
   * silent from the header to the final report — minutes of nothing while it
   * works through every unit, which reads exactly like a hang.
   */
  onProgress?: (done: number, total: number, propertyName: string) => void;
}

/** ReconcileOptions with the defaults filled in. */
type ResolvedOptions = ReconcileOptions & {
  apply: boolean;
  respectUnknownSkips: boolean;
  verify: boolean;
  orphanVisibilityDays: number;
};

export interface ReconcileReport {
  tenantId: string;
  fromDate: string | null;
  apply: boolean;
  propertiesScanned: number;
  propertiesWithDrift: number;
  bookingsConsidered: number;
  drift: DriftItem[];
  counts: Record<DriftKind, number>;
  appliedCount: number;
  needsReviewCount: number;
  /** Non-empty means --apply did not converge: a real bug, not stale data. */
  verifyFailures: string[];
  /** Properties whose transaction threw; their drift is unfixed. */
  errors: { propertyId: string; propertyName: string; message: string }[];
  excluded: string[];
}

/** One slot the bookings table says must exist. */
interface ExpectedSlot {
  key: string;
  fromBookingId: string | null;
  toBookingId: string | null;
  availableFrom: Date | null;
  dueBy: Date | null;
  isOwnerStay: boolean;
}

const slotKey = (from: string | null, to: string | null) =>
  `${from ?? 'NULL'}>${to ?? 'NULL'}`;

type TurnoverWithAssignmentCount = Turnover & { _assignmentCount: number };

@Injectable()
export class TurnoverReconcileService {
  private readonly logger = new Logger(TurnoverReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly turnoverSync: TurnoverSyncService,
  ) {}

  // ==========================================================================
  // Entry point
  // ==========================================================================

  async reconcileTenant(options: ReconcileOptions): Promise<ReconcileReport> {
    const opts: ResolvedOptions = {
      ...options,
      apply: options.apply ?? false,
      respectUnknownSkips: options.respectUnknownSkips ?? true,
      verify: options.verify ?? false,
      orphanVisibilityDays: options.orphanVisibilityDays ?? POOL_VISIBILITY_DAYS,
    };

    const report: ReconcileReport = {
      tenantId: opts.tenantId,
      fromDate: opts.fromDate ? opts.fromDate.toISOString() : null,
      apply: opts.apply,
      propertiesScanned: 0,
      propertiesWithDrift: 0,
      bookingsConsidered: 0,
      drift: [],
      counts: {
        MISSING: 0, TIME_DRIFT: 0, STALE_ENDPOINT: 0, DUPLICATE_ACTIVE: 0,
        ORPHAN: 0, LEGACY_MERGE: 0, CHAIN_CYCLE: 0, IMPOSSIBLE_WINDOW: 0,
      },
      appliedCount: 0,
      needsReviewCount: 0,
      verifyFailures: [],
      errors: [],
      excluded: [],
    };

    if (opts.fromDate) {
      report.excluded.push(
        `Bookings arriving before ${opts.fromDate.toISOString()} were not ` +
        `examined (--since window). Their turnovers, if drifted, stay drifted.`,
      );
    }

    const properties = await this.prisma.property.findMany({
      where: {
        tenantId: opts.tenantId,
        ...(opts.propertyIds?.length ? { id: { in: opts.propertyIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    this.logger.log(
      `Reconciling ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} ` +
      `for tenant ${opts.tenantId} (${opts.apply ? 'APPLY' : 'dry run'})`,
    );

    let historicalOrphansLeft = 0;
    let outOfWindowSkipped = 0;
    let impossibleWindowsHistorical = 0;

    let scanned = 0;
    for (const property of properties) {
      opts.onProgress?.(++scanned, properties.length, property.name);
      report.propertiesScanned++;
      try {
        // One transaction per property: a single bad unit must not roll back
        // the others' repairs.
        const result = await this.prisma.$transaction(
          async (tx) => this.reconcileProperty(tx, property, opts),
          { timeout: 120_000 },
        );

        report.bookingsConsidered += result.bookingsConsidered;
        historicalOrphansLeft += result.historicalOrphansLeft;
        outOfWindowSkipped += result.outOfWindowSkipped;
        impossibleWindowsHistorical += result.impossibleWindowsHistorical;
        if (result.drift.length > 0) report.propertiesWithDrift++;
        for (const item of result.drift) {
          report.drift.push(item);
          report.counts[item.kind]++;
          if (item.applied) report.appliedCount++;
          if (item.needsReview) report.needsReviewCount++;
        }
        report.verifyFailures.push(...result.verifyFailures);
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(
          `Property ${property.name} (${property.id}) failed: ${message}`,
        );
        report.errors.push({
          propertyId: property.id,
          propertyName: property.name,
          message,
        });
      }
    }

    if (impossibleWindowsHistorical > 0) {
      report.excluded.push(
        `${impossibleWindowsHistorical} slot(s) end before they begin but are ` +
        `already past the pool cutoff, so they were counted rather than ` +
        `reported. Almost all are same-day turnovers whose arrival was stored ` +
        `at midnight; repair those with backfill:checkin-times --include-past.`,
      );
    }

    if (outOfWindowSkipped > 0) {
      report.excluded.push(
        `${outOfWindowSkipped} live turnover(s) ended before the --since ` +
        `window and were not classified. They are almost always completed ` +
        `cleanings from earlier periods. Use --all-history to judge them.`,
      );
    }

    if (historicalOrphansLeft > 0) {
      report.excluded.push(
        `${historicalOrphansLeft} orphaned turnover(s) older than ` +
        `${opts.orphanVisibilityDays} day(s) were left in place — they are past ` +
        `the pool cutoff, so no cleaner can claim them. Raise ` +
        `--orphan-window to clear them.`,
      );
    }

    return report;
  }

  // ==========================================================================
  // Per-property pass
  // ==========================================================================

  private async reconcileProperty(
    tx: Tx,
    property: { id: string; name: string },
    opts: ResolvedOptions,
  ): Promise<{
    drift: DriftItem[];
    bookingsConsidered: number;
    verifyFailures: string[];
    historicalOrphansLeft: number;
    outOfWindowSkipped: number;
    impossibleWindowsHistorical: number;
  }> {
    const drift = await this.detectAndFix(tx, property, opts);
    const verifyFailures: string[] = [];

    if (opts.apply && opts.verify) {
      // Same transaction, so this sees our own writes. Anything left means the
      // repair logic itself is wrong — the whole point of checking.
      const residual = await this.detectAndFix(tx, property, {
        ...opts,
        apply: false,
        verify: false,
      });
      const real = residual.drift.filter((d) => !d.needsReview);
      if (real.length > 0) {
        verifyFailures.push(
          `${property.name} (${property.id}): ${real.length} drift item(s) ` +
          `remained after apply — ${real.map((d) => d.kind).join(', ')}`,
        );
      }
    }

    return {
      drift: drift.drift,
      bookingsConsidered: drift.bookingsConsidered,
      historicalOrphansLeft: drift.historicalOrphansLeft,
      outOfWindowSkipped: drift.outOfWindowSkipped,
      impossibleWindowsHistorical: drift.impossibleWindowsHistorical,
      verifyFailures,
    };
  }

  private async detectAndFix(
    tx: Tx,
    property: { id: string; name: string },
    opts: ResolvedOptions,
  ): Promise<{
    drift: DriftItem[];
    bookingsConsidered: number;
    historicalOrphansLeft: number;
    outOfWindowSkipped: number;
    impossibleWindowsHistorical: number;
  }> {
    const drift: DriftItem[] = [];
    let historicalOrphansLeft = 0;
    let outOfWindowSkipped = 0;
    let impossibleWindowsHistorical = 0;
    const add = (
      kind: DriftKind,
      detail: string,
      action: string,
      extra: { turnoverId?: string; needsReview?: boolean; applied?: boolean } = {},
    ) => {
      drift.push({
        kind,
        propertyId: property.id,
        propertyName: property.name,
        detail,
        action,
        turnoverId: extra.turnoverId,
        needsReview: extra.needsReview ?? false,
        applied: extra.applied ?? false,
      });
    };

    // ── Bookings: the source of truth ──
    const bookings = await tx.booking.findMany({
      where: {
        propertyId: property.id,
        tenantId: opts.tenantId,
        status: 'CONFIRMED',
        ...(opts.fromDate ? { checkInTime: { gte: opts.fromDate } } : {}),
      },
      // id as a stable tie-break: two bookings can share a checkInTime, and an
      // unstable order would make the reconciler flip-flop between runs.
      orderBy: [{ checkInTime: 'asc' }, { id: 'asc' }],
    });

    // The booking just before the window, so the first in-window slot gets its
    // real predecessor instead of looking like the start of the chain.
    const anchor = opts.fromDate
      ? await tx.booking.findFirst({
          where: {
            propertyId: property.id,
            tenantId: opts.tenantId,
            status: 'CONFIRMED',
            checkInTime: { lt: opts.fromDate },
          },
          orderBy: [{ checkInTime: 'desc' }, { id: 'desc' }],
        })
      : null;

    const expected = this.buildExpectedSlots(bookings, anchor);

    // A slot that ends before it starts means two CONFIRMED bookings occupy
    // the unit at once — one guest still in when the next is already due. The
    // chain is doing its job here; the bookings are wrong, usually a
    // cancellation the PMS never told us about. So this is reported and never
    // repaired: inventing a window would paper over the real fault, and the
    // cleaner would be handed a cleaning that is overdue the moment it appears.
    const actionableFrom = new Date(
      Date.now() - opts.orphanVisibilityDays * 24 * 60 * 60 * 1000,
    );

    for (const slot of expected) {
      if (!slot.availableFrom || !slot.dueBy) continue;
      if (slot.availableFrom <= slot.dueBy) continue;

      // Past the pool cutoff nobody can act on it. The first production run
      // reported 3564 of these across 241 properties — every same-day turnover
      // in the archive — and buried the handful that were still live. Same
      // mistake the orphan check used to make: a detector that flags what
      // cannot be acted on is not a detector.
      //
      // Judge that by the LATER endpoint, which for an inverted window is
      // availableFrom — and availableFrom is exactly what TurnoversService
      // filters the pool on. Testing dueBy instead (the first attempt at this)
      // hid the one shape that matters: Sokolovská 65/201 P had a slot
      // available today with a due date four days in the past, so the cleaner
      // saw it in her list this morning while the detector called it archive
      // and said nothing.
      const lateEnd =
        slot.availableFrom > slot.dueBy ? slot.availableFrom : slot.dueBy;
      if (lateEnd < actionableFrom) {
        impossibleWindowsHistorical++;
        continue;
      }

      // A midnight arrival can invert a window on its own: the previous guest
      // leaves at 10:00 and the next "arrives" at 00:00 the same day, so the
      // slot reads backwards by ten hours. That is a missing check-in time,
      // not a second guest, and saying "the bookings overlap" sends whoever
      // reads it into Avantio hunting a cancellation that is not there.
      //
      // But only when filling the time in would actually fix it. Sokolovská
      // 65/201 P was inverted by four days and Tyršova 13/1 by a month, both
      // with a midnight arrival — and the first version of this message told
      // the operator to set the arrival time, which would have changed
      // nothing. Past a day the midnight is a coincidence and two bookings
      // genuinely hold the unit at once.
      const invertedByMs = slot.availableFrom.getTime() - slot.dueBy.getTime();
      const arrivalUnknown =
        timeInAppZone(slot.dueBy) === '00:00' && invertedByMs < 24 * 60 * 60 * 1000;

      add(
        'IMPOSSIBLE_WINDOW',
        `slot ${this.describeSlot(slot)} is available from ` +
        `${slot.availableFrom.toISOString()} but due by ` +
        `${slot.dueBy.toISOString()} — ` +
        (arrivalUnknown
          ? 'the arrival has no time (midnight), so the window is inverted'
          : `the two bookings overlap by ${Math.round(invertedByMs / 3_600_000)}h`),
        arrivalUnknown
          ? 'left alone — set the arrival time in Planning, or run ' +
            'backfill:checkin-times for this booking'
          : 'left alone — check both bookings in the PMS; one is probably ' +
            'cancelled there and still CONFIRMED here',
        { needsReview: true },
      );
    }

    // ── Turnovers currently attached to this property ──
    const actives = await this.loadActiveTurnovers(tx, property.id);

    for (const t of actives) {
      if (t.supersededById === t.id) {
        add(
          'CHAIN_CYCLE',
          `turnover ${t.id} is superseded by itself`,
          'left alone — a supersession cycle needs a human',
          { turnoverId: t.id, needsReview: true },
        );
      }
    }

    const live = actives.filter((t) => LIVE_STATUSES.includes(t.status));

    // Slots a human closed: covered, never recreated.
    const closedSlotKeys = new Set<string>();
    for (const t of actives) {
      const humanClosed =
        t.status === TurnoverStatus.CANCELLED ||
        (t.status === TurnoverStatus.SKIPPED &&
          (t.skipReason === 'MANAGER_SKIPPED' ||
            (t.skipReason === null && opts.respectUnknownSkips)));
      if (humanClosed) closedSlotKeys.add(slotKey(t.fromBookingId, t.toBookingId));
    }

    // Legacy rows from before mergeAcrossCancellation set supersededById.
    for (const t of actives) {
      if (
        t.status === TurnoverStatus.SKIPPED &&
        t.skipReason === 'MERGED_ON_CANCELLATION' &&
        t.supersededById === null
      ) {
        add(
          'LEGACY_MERGE',
          `turnover ${t.id} is a merged-away slot still marked active ` +
          `(supersededById IS NULL)`,
          opts.apply
            ? 'left as SKIPPED — already invisible to the read path, no write needed'
            : 'no action needed; reported for visibility',
          { turnoverId: t.id },
        );
      }
    }

    // ── Match live turnovers to expected slots ──
    const expectedByKey = new Map(expected.map((s) => [s.key, s]));
    const liveByKey = new Map<string, TurnoverWithAssignmentCount[]>();
    for (const t of live) {
      const key = slotKey(t.fromBookingId, t.toBookingId);
      const bucket = liveByKey.get(key);
      if (bucket) bucket.push(t);
      else liveByKey.set(key, [t]);
    }

    const claimed = new Set<string>(); // turnover ids already accounted for

    // 1) Exact key matches — dedupe, then check the times.
    for (const [key, slot] of expectedByKey) {
      const matches = liveByKey.get(key) ?? [];
      if (matches.length === 0) continue;

      const [keeper, ...losers] = this.rankForKeeping(matches);
      matches.forEach((m) => claimed.add(m.id));

      for (const loser of losers) {
        if (this.isProtected(loser)) {
          add(
            'DUPLICATE_ACTIVE',
            `slot ${this.describeSlot(slot)} has ${matches.length} live turnovers; ` +
            `duplicate ${loser.id} is ${loser.status} with ` +
            `${loser._assignmentCount} assignment(s)`,
            'left alone — carries real work; a human must decide which to keep',
            { turnoverId: loser.id, needsReview: true },
          );
          continue;
        }
        let applied = false;
        if (opts.apply) {
          await tx.turnover.update({
            where: { id: loser.id },
            data: { supersededById: keeper.id },
          });
          await this.audit(tx, opts.tenantId, 'turnover.duplicate_retired', loser.id, {
            propertyId: property.id,
            keptTurnoverId: keeper.id,
            slot: this.describeSlot(slot),
          });
          applied = true;
        }
        add(
          'DUPLICATE_ACTIVE',
          `slot ${this.describeSlot(slot)} has ${matches.length} live turnovers ` +
          `(${matches.map((m) => `${m.id}:${m.status}`).join(', ')})`,
          `retire ${loser.id}, keep ${keeper.id} (${keeper.status}, ` +
          `${keeper._assignmentCount} assignment(s))`,
          { turnoverId: loser.id, applied },
        );
      }

      // Times / owner flag on the keeper. Only changed keys go into `changes`:
      // supersede() uses `'key' in changes`, so an explicit undefined would be
      // read as "set this to undefined".
      const changes: {
        availableFrom?: Date | null;
        dueBy?: Date | null;
        isOwnerStay?: boolean;
      } = {};
      const diffs: string[] = [];
      if (!this.sameTime(keeper.availableFrom, slot.availableFrom)) {
        diffs.push(
          `availableFrom ${this.fmt(keeper.availableFrom)} -> ${this.fmt(slot.availableFrom)}`,
        );
        changes.availableFrom = slot.availableFrom;
      }
      if (!this.sameTime(keeper.dueBy, slot.dueBy)) {
        diffs.push(`dueBy ${this.fmt(keeper.dueBy)} -> ${this.fmt(slot.dueBy)}`);
        changes.dueBy = slot.dueBy;
      }
      if (keeper.isOwnerStay !== slot.isOwnerStay) {
        diffs.push(`isOwnerStay ${keeper.isOwnerStay} -> ${slot.isOwnerStay}`);
        changes.isOwnerStay = slot.isOwnerStay;
      }
      if (diffs.length === 0) continue;

      let applied = false;
      if (opts.apply) {
        const fresh = await this.turnoverSync.supersede(keeper.id, changes, tx);
        claimed.add(fresh.id);
        await this.audit(tx, opts.tenantId, 'turnover.times_reconciled', keeper.id, {
          propertyId: property.id,
          newTurnoverId: fresh.id,
          diffs,
        });
        applied = true;
      }
      add(
        'TIME_DRIFT',
        `slot ${this.describeSlot(slot)} turnover ${keeper.id}: ${diffs.join('; ')}`,
        'supersede with the times derived from the bookings',
        { turnoverId: keeper.id, applied },
      );
    }

    // 2) Expected slots with no live turnover: re-thread a stale one if we can
    //    identify it, otherwise create.
    for (const [key, slot] of expectedByKey) {
      if ((liveByKey.get(key) ?? []).length > 0) continue;
      if (closedSlotKeys.has(key)) continue; // a human closed this slot

      const candidate = this.findStaleCandidate(slot, live, claimed, expectedByKey);

      if (candidate) {
        claimed.add(candidate.id);
        let applied = false;
        if (opts.apply) {
          const fresh = await this.turnoverSync.supersede(
            candidate.id,
            {
              fromBookingId: slot.fromBookingId,
              toBookingId: slot.toBookingId,
              availableFrom: slot.availableFrom,
              dueBy: slot.dueBy,
              isOwnerStay: slot.isOwnerStay,
            },
            tx,
          );
          claimed.add(fresh.id);
          await this.audit(tx, opts.tenantId, 'turnover.rethreaded', candidate.id, {
            propertyId: property.id,
            newTurnoverId: fresh.id,
            was: this.describeEndpoints(candidate),
            now: this.describeSlot(slot),
          });
          applied = true;
        }
        add(
          'STALE_ENDPOINT',
          `turnover ${candidate.id} points at ${this.describeEndpoints(candidate)} ` +
          `but the bookings say ${this.describeSlot(slot)}`,
          `supersede onto the correct endpoints, keeping ` +
          `${candidate._assignmentCount} assignment(s) and status ${candidate.status}`,
          { turnoverId: candidate.id, applied },
        );
        continue;
      }

      let applied = false;
      let newId: string | undefined;
      if (opts.apply) {
        const fresh = await this.turnoverSync.createTurnover(
          {
            tenantId: opts.tenantId,
            propertyId: property.id,
            fromBookingId: slot.fromBookingId,
            toBookingId: slot.toBookingId,
            availableFrom: slot.availableFrom,
            dueBy: slot.dueBy,
            isOwnerStay: slot.isOwnerStay,
          },
          tx,
        );
        newId = fresh.id;
        claimed.add(fresh.id);
        await this.audit(tx, opts.tenantId, 'turnover.created_by_reconcile', fresh.id, {
          propertyId: property.id,
          slot: this.describeSlot(slot),
        });
        applied = true;
      }
      add(
        'MISSING',
        `no live turnover for slot ${this.describeSlot(slot)}`,
        opts.apply ? `created ${newId}` : 'create it',
        { turnoverId: newId, applied },
      );
    }

    // 3) Live turnovers that match nothing the bookings justify.
    for (const t of live) {
      if (claimed.has(t.id)) continue;

      // The expected slots above were derived from bookings inside --since,
      // but this list is every live turnover on the property, with no window
      // at all. Without this guard every completed cleaning from before the
      // window has nothing to match and gets reported as an orphan — 1783 of
      // them on the first real run, which buried the five items that were
      // actually wrong. A turnover whose late end predates the window was
      // simply not examined; say so in `excluded` instead of accusing it.
      if (opts.fromDate) {
        const lateEnd = t.dueBy ?? t.availableFrom ?? t.createdAt;
        if (lateEnd < opts.fromDate) {
          outOfWindowSkipped++;
          continue;
        }
      }

      // Our snapshot predates the writes above. createTurnover() and
      // supersede() both call TurnoverSyncService.enforceUniqueActive(), which
      // retires rows sharing an endpoint — so this row may already be resolved.
      // Cancelling it now would stamp a misleading status on a retired row.
      const current = await tx.turnover.findUnique({
        where: { id: t.id },
        select: { supersededById: true, status: true },
      });
      if (!current) continue;
      if (current.supersededById !== null) {
        add(
          'ORPHAN',
          `turnover ${t.id} was retired by the repairs above ` +
          `(superseded by ${current.supersededById})`,
          'no action needed — already out of the read path',
          { turnoverId: t.id, applied: opts.apply },
        );
        continue;
      }

      const why = await this.explainOrphan(tx, t);

      if (this.isProtected(t) || t._assignmentCount > 0) {
        add(
          'ORPHAN',
          `turnover ${t.id} (${t.status}, ${t._assignmentCount} assignment(s)) ` +
          `matches no slot: ${why}`,
          'left alone — carries real work; reassign or cancel it in the UI',
          { turnoverId: t.id, needsReview: true },
        );
        continue;
      }

      // Only clear what a cleaner could still act on. The carry-forward date is
      // how the pool and the calendar decide where a turnover lands.
      const carryForward = t.availableFrom ?? t.dueBy ?? t.createdAt;
      const visibleCutoff = new Date(
        Date.now() - opts.orphanVisibilityDays * 24 * 60 * 60 * 1000,
      );
      if (carryForward < visibleCutoff) {
        historicalOrphansLeft++;
        continue;
      }

      let applied = false;
      if (opts.apply) {
        await tx.turnover.update({
          where: { id: t.id },
          data: { status: TurnoverStatus.CANCELLED, cancelledAt: new Date() },
        });
        await this.audit(tx, opts.tenantId, 'turnover.orphan_cancelled', t.id, {
          propertyId: property.id,
          endpoints: this.describeEndpoints(t),
          reason: why,
        });
        applied = true;
      }
      add(
        'ORPHAN',
        `turnover ${t.id} (${t.status}, no assignments) matches no slot: ${why}`,
        'mark CANCELLED so it leaves the read path; the row is kept for audit',
        { turnoverId: t.id, applied },
      );
    }

    return {
      drift,
      bookingsConsidered: bookings.length,
      historicalOrphansLeft,
      outOfWindowSkipped,
      impossibleWindowsHistorical,
    };
  }

  // ==========================================================================
  // Chain construction
  // ==========================================================================

  private buildExpectedSlots(
    bookings: Booking[],
    anchor: Booking | null,
  ): ExpectedSlot[] {
    const slots: ExpectedSlot[] = [];
    if (bookings.length === 0) return slots;

    for (let i = 0; i < bookings.length; i++) {
      const to = bookings[i];
      const from = i === 0 ? anchor : bookings[i - 1];
      slots.push({
        key: slotKey(from?.id ?? null, to.id),
        fromBookingId: from?.id ?? null,
        toBookingId: to.id,
        availableFrom: from?.checkOutTime ?? null,
        dueBy: to.checkInTime,
        isOwnerStay: to.isOwnerStay,
      });
    }

    // Trailing slot: the unit is free after the last arrival departs. Because
    // the window is only bounded below, the last in-window booking is also the
    // property's last booking overall.
    const last = bookings[bookings.length - 1];
    slots.push({
      key: slotKey(last.id, null),
      fromBookingId: last.id,
      toBookingId: null,
      availableFrom: last.checkOutTime,
      dueBy: null,
      isOwnerStay: false,
    });

    return slots;
  }

  private async loadActiveTurnovers(
    tx: Tx,
    propertyId: string,
  ): Promise<TurnoverWithAssignmentCount[]> {
    const rows = await tx.turnover.findMany({
      where: { propertyId, supersededById: null },
      include: { _count: { select: { assignments: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ _count, ...turnover }) => ({
      ...turnover,
      _assignmentCount: _count.assignments,
    }));
  }

  /**
   * A slot with no exact match may still be served by a turnover that shares
   * exactly one endpoint with it — the classic shape after a neighbour is
   * cancelled or moved. Re-threading that row preserves the assignment and the
   * cleaner's context; creating a fresh one would silently drop both.
   *
   * Cancelling a middle booking leaves TWO such candidates: (PREV -> gone) and
   * (gone -> NEXT). Both share one endpoint with the merged slot, so this has to
   * choose rather than bail — bailing would create a third row and orphan the
   * two that hold the real assignments. The order below keeps the most work and,
   * on a tie, matches what TurnoverSyncService.mergeAcrossCancellation does:
   * keep the incoming-side row (PREV -> ...).
   */
  private findStaleCandidate(
    slot: ExpectedSlot,
    live: TurnoverWithAssignmentCount[],
    claimed: Set<string>,
    expectedByKey: Map<string, ExpectedSlot>,
  ): TurnoverWithAssignmentCount | null {
    const shares = live.filter((t) => {
      if (claimed.has(t.id)) return false;
      // Its own key must not be a slot we expect — otherwise it belongs there.
      if (expectedByKey.has(slotKey(t.fromBookingId, t.toBookingId))) return false;
      const sameTo = slot.toBookingId !== null && t.toBookingId === slot.toBookingId;
      const sameFrom =
        slot.fromBookingId !== null && t.fromBookingId === slot.fromBookingId;
      return sameTo || sameFrom;
    });

    if (shares.length === 0) return null;

    const ranked = [...shares].sort((a, b) => {
      const byAssignments = b._assignmentCount - a._assignmentCount;
      if (byAssignments !== 0) return byAssignments;
      const byStatus = STATUS_RANK[b.status] - STATUS_RANK[a.status];
      if (byStatus !== 0) return byStatus;
      const aFromSide = a.fromBookingId === slot.fromBookingId ? 0 : 1;
      const bFromSide = b.fromBookingId === slot.fromBookingId ? 0 : 1;
      if (aFromSide !== bFromSide) return aFromSide - bFromSide;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return ranked[0];
  }

  private async explainOrphan(
    tx: Tx,
    t: TurnoverWithAssignmentCount,
  ): Promise<string> {
    const reasons: string[] = [];
    for (const [label, id] of [
      ['fromBooking', t.fromBookingId],
      ['toBooking', t.toBookingId],
    ] as const) {
      if (!id) continue;
      const b = await tx.booking.findUnique({
        where: { id },
        select: { status: true, propertyId: true },
      });
      if (!b) reasons.push(`${label} ${id} no longer exists`);
      else if (b.status === 'CANCELLED') reasons.push(`${label} ${id} is CANCELLED`);
      else if (b.propertyId !== t.propertyId)
        reasons.push(`${label} ${id} now belongs to another property`);
    }
    if (t.fromBookingId === null && t.toBookingId === null) {
      reasons.push('both endpoints are NULL');
    }
    return reasons.length ? reasons.join('; ') : 'no matching adjacency in bookings';
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private rankForKeeping(
    candidates: TurnoverWithAssignmentCount[],
  ): TurnoverWithAssignmentCount[] {
    return [...candidates].sort((a, b) => {
      const byStatus = STATUS_RANK[b.status] - STATUS_RANK[a.status];
      if (byStatus !== 0) return byStatus;
      const byAssignments = b._assignmentCount - a._assignmentCount;
      if (byAssignments !== 0) return byAssignments;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private isProtected(t: Turnover): boolean {
    return PROTECTED_STATUSES.includes(t.status);
  }

  private sameTime(a: Date | null, b: Date | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.getTime() === b.getTime();
  }

  private fmt(d: Date | null): string {
    return d ? d.toISOString() : 'null';
  }

  private describeSlot(s: ExpectedSlot): string {
    return `[${s.fromBookingId ?? 'START'} -> ${s.toBookingId ?? 'END'}]`;
  }

  private describeEndpoints(t: Turnover): string {
    return `[${t.fromBookingId ?? 'START'} -> ${t.toBookingId ?? 'END'}]`;
  }

  private async audit(
    tx: Tx,
    tenantId: string,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId,
        category: 'SYSTEM',
        action,
        actorId: null,
        actorEmail: 'turnover-reconcile@cleanops',
        targetType: 'Turnover',
        targetId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
