// backend/src/integrations/turnover-sync.service.ts
//
// Pure chain-manipulation service for the Turnover model. No knowledge of
// Avantio API; no notifications; no audit logging side-effects. Its job is
// solely to keep the turnover chain at a property in a consistent state when
// a booking is inserted, cancelled, or modified.
//
// All public methods accept a Prisma TransactionClient so callers can wrap
// chain manipulation in an outer transaction alongside other writes (e.g.
// the Booking + Cleaning writes still happening in BookingSyncService).

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Booking, Turnover, TurnoverStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class TurnoverSyncService {
  private readonly logger = new Logger(TurnoverSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // Public entry points — called from BookingSyncService
  // ==========================================================================

  /**
   * A new booking has just been inserted. Slot it into the chain at its
   * property. Idempotent: if the booking already has active turnovers,
   * this is a no-op.
   */
  async onBookingInserted(bookingId: string, tx: Tx): Promise<void> {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      this.logger.warn(`onBookingInserted: booking ${bookingId} not found`);
      return;
    }
    if (booking.status === 'CANCELLED') {
      this.logger.debug(`onBookingInserted: booking ${bookingId} is CANCELLED, skipping`);
      return;
    }

    // Idempotency: if active turnovers already reference this booking, skip.
    // Caller is expected to use onBookingModified for updates instead.
    const existing = await tx.turnover.findFirst({
      where: {
        supersededById: null,
        OR: [{ fromBookingId: bookingId }, { toBookingId: bookingId }],
      },
    });
    if (existing) {
      this.logger.debug(
        `onBookingInserted: booking ${bookingId} already has active turnovers, skipping`,
      );
      return;
    }

    const prev = await this.findPrev(booking.propertyId, booking.checkInTime, booking.id, tx);
    const next = await this.findNext(booking.propertyId, booking.checkInTime, booking.id, tx);

    if (prev && next) {
      await this.insertBetween(booking, prev, next, tx);
    } else if (prev && !next) {
      await this.insertAsLatest(booking, prev, tx);
    } else if (!prev && next) {
      await this.insertAsEarliest(booking, next, tx);
    } else {
      await this.insertAsOnly(booking, tx);
    }
  }

  /**
   * A booking's status has flipped to CANCELLED. Stitch the chain back
   * together: turnovers before+after collapse into a single one if both exist.
   */
  async onBookingCancelled(bookingId: string, tx: Tx): Promise<void> {
    const t1 = await tx.turnover.findFirst({
      where: { toBookingId: bookingId, supersededById: null },
    });
    const t2 = await tx.turnover.findFirst({
      where: { fromBookingId: bookingId, supersededById: null },
    });

    if (t1 && t2) {
      await this.mergeAcrossCancellation(t1, t2, tx);
    } else if (t1 && !t2) {
      // K was the latest booking — disconnect its toBookingId end
      await this.supersede(t1.id, { toBookingId: null, dueBy: null }, tx);
    } else if (!t1 && t2) {
      // K was the earliest booking — disconnect its fromBookingId end
      await this.supersede(t2.id, { fromBookingId: null, availableFrom: null }, tx);
    } else {
      this.logger.warn(
        `onBookingCancelled: no active turnovers found for booking ${bookingId}`,
      );
    }
  }

  /**
   * A booking's dates have changed. Two paths:
   *   - If PREV/NEXT references haven't changed: just update anchors in place.
   *   - If they have: cancel from the old position, insert into the new one.
   *
   * Per Decision 4A: strict reference equality on PREV/NEXT id.
   */
  async onBookingModified(
    bookingId: string,
    oldCheckInTime: Date,
    tx: Tx,
  ): Promise<void> {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.status === 'CANCELLED') return;

    const oldPrev = await this.findPrev(booking.propertyId, oldCheckInTime, booking.id, tx);
    const oldNext = await this.findNext(booking.propertyId, oldCheckInTime, booking.id, tx);
    const newPrev = await this.findPrev(booking.propertyId, booking.checkInTime, booking.id, tx);
    const newNext = await this.findNext(booking.propertyId, booking.checkInTime, booking.id, tx);

    const samePosition =
      (oldPrev?.id ?? null) === (newPrev?.id ?? null) &&
      (oldNext?.id ?? null) === (newNext?.id ?? null);

    if (samePosition) {
      // Position unchanged — only update anchors
      const t1 = await tx.turnover.findFirst({
        where: { toBookingId: booking.id, supersededById: null },
      });
      if (t1 && this.notEqualTime(t1.dueBy, booking.checkInTime)) {
        await this.supersede(t1.id, { dueBy: booking.checkInTime }, tx);
      }

      const t2 = await tx.turnover.findFirst({
        where: { fromBookingId: booking.id, supersededById: null },
      });
      if (t2 && this.notEqualTime(t2.availableFrom, booking.checkOutTime)) {
        await this.supersede(t2.id, { availableFrom: booking.checkOutTime }, tx);
      }
    } else {
      // Position changed — re-thread the chain
      this.logger.debug(
        `onBookingModified: booking ${bookingId} moved positions, re-threading chain`,
      );
      await this.onBookingCancelled(booking.id, tx);
      await this.onBookingInserted(booking.id, tx);
    }
  }

  // ==========================================================================
  // Adjacent-booking lookup
  // ==========================================================================

  /**
   * Most recent booking before `checkInTime` at this property, excluding the
   * given booking id and CANCELLED ones. UNPAID and OWNER Avantio statuses
   * arrive in our DB already mapped to CONFIRMED (see Decision 3), so the
   * filter naturally includes them.
   */
  private async findPrev(
    propertyId: string,
    checkInTime: Date,
    excludeBookingId: string,
    tx: Tx,
  ): Promise<Booking | null> {
    return tx.booking.findFirst({
      where: {
        propertyId,
        status: 'CONFIRMED',
        checkInTime: { lt: checkInTime },
        NOT: { id: excludeBookingId },
      },
      orderBy: { checkInTime: 'desc' },
    });
  }

  private async findNext(
    propertyId: string,
    checkInTime: Date,
    excludeBookingId: string,
    tx: Tx,
  ): Promise<Booking | null> {
    return tx.booking.findFirst({
      where: {
        propertyId,
        status: 'CONFIRMED',
        checkInTime: { gt: checkInTime },
        NOT: { id: excludeBookingId },
      },
      orderBy: { checkInTime: 'asc' },
    });
  }

  // ==========================================================================
  // Insertion cases
  // ==========================================================================

  /**
   * Case A — K inserts between PREV and NEXT. The existing PREV→NEXT
   * turnover (if any) gets superseded to PREV→K, and a new K→NEXT is created.
   */
  private async insertBetween(K: Booking, prev: Booking, next: Booking, tx: Tx): Promise<void> {
    const existing = await tx.turnover.findFirst({
      where: {
        fromBookingId: prev.id,
        toBookingId: next.id,
        supersededById: null,
      },
    });

    if (existing) {
      await this.supersede(existing.id, {
        toBookingId: K.id,
        dueBy: K.checkInTime,
      }, tx);
    } else {
      // Chain wasn't complete before — create the PREV→K leg explicitly
      await this.createTurnover({
        tenantId: K.tenantId,
        propertyId: K.propertyId,
        fromBookingId: prev.id,
        toBookingId: K.id,
        availableFrom: prev.checkOutTime,
        dueBy: K.checkInTime,
        isOwnerStay: K.isOwnerStay,
      }, tx);
    }

    // Always create the K→NEXT leg fresh (it didn't exist as a single chain edge before)
    await this.createTurnover({
      tenantId: K.tenantId,
      propertyId: K.propertyId,
      fromBookingId: K.id,
      toBookingId: next.id,
      availableFrom: K.checkOutTime,
      dueBy: next.checkInTime,
      isOwnerStay: next.isOwnerStay,
    }, tx);
  }

  /**
   * Case B — K becomes the latest booking. Per Decision 2A, we maintain a
   * "trailing null" turnover (fromBookingId=PREV, toBookingId=NULL). If one
   * exists for PREV, we supersede it to point at K. Then we create a fresh
   * trailing null for K.
   */
  private async insertAsLatest(K: Booking, prev: Booking, tx: Tx): Promise<void> {
    const trailing = await tx.turnover.findFirst({
      where: {
        fromBookingId: prev.id,
        toBookingId: null,
        supersededById: null,
      },
    });

    if (trailing) {
      await this.supersede(trailing.id, {
        toBookingId: K.id,
        dueBy: K.checkInTime,
      }, tx);
    } else {
      await this.createTurnover({
        tenantId: K.tenantId,
        propertyId: K.propertyId,
        fromBookingId: prev.id,
        toBookingId: K.id,
        availableFrom: prev.checkOutTime,
        dueBy: K.checkInTime,
        isOwnerStay: K.isOwnerStay,
      }, tx);
    }

    // New trailing null for K
    await this.createTurnover({
      tenantId: K.tenantId,
      propertyId: K.propertyId,
      fromBookingId: K.id,
      toBookingId: null,
      availableFrom: K.checkOutTime,
      dueBy: null,
      isOwnerStay: false,
    }, tx);
  }

  /**
   * Case C — K becomes the earliest booking. Mirror of Case B: handle the
   * "leading null" turnover for NEXT, create a new leading null for K.
   */
  private async insertAsEarliest(K: Booking, next: Booking, tx: Tx): Promise<void> {
    const leading = await tx.turnover.findFirst({
      where: {
        fromBookingId: null,
        toBookingId: next.id,
        supersededById: null,
      },
    });

    if (leading) {
      await this.supersede(leading.id, {
        fromBookingId: K.id,
        availableFrom: K.checkOutTime,
      }, tx);
    } else {
      await this.createTurnover({
        tenantId: K.tenantId,
        propertyId: K.propertyId,
        fromBookingId: K.id,
        toBookingId: next.id,
        availableFrom: K.checkOutTime,
        dueBy: next.checkInTime,
        isOwnerStay: next.isOwnerStay,
      }, tx);
    }

    // New leading null for K (the initial cleaning at this property, or after long idle)
    await this.createTurnover({
      tenantId: K.tenantId,
      propertyId: K.propertyId,
      fromBookingId: null,
      toBookingId: K.id,
      availableFrom: null,
      dueBy: K.checkInTime,
      isOwnerStay: K.isOwnerStay,
    }, tx);
  }

  /**
   * Case D — K is the only booking at the property. Create both leading and
   * trailing null turnovers.
   */
  private async insertAsOnly(K: Booking, tx: Tx): Promise<void> {
    await this.createTurnover({
      tenantId: K.tenantId,
      propertyId: K.propertyId,
      fromBookingId: null,
      toBookingId: K.id,
      availableFrom: null,
      dueBy: K.checkInTime,
      isOwnerStay: K.isOwnerStay,
    }, tx);

    await this.createTurnover({
      tenantId: K.tenantId,
      propertyId: K.propertyId,
      fromBookingId: K.id,
      toBookingId: null,
      availableFrom: K.checkOutTime,
      dueBy: null,
      isOwnerStay: false,
    }, tx);
  }

  // ==========================================================================
  // Cancellation merge
  // ==========================================================================

  /**
   * K is being cancelled. T1 = (PREV → K) and T2 = (K → NEXT) both exist.
   * Per Decision 1B (supersession across the board): supersede T1 with the
   * merged endpoints (PREV → NEXT), and mark T2 as SKIPPED (no actionable
   * work — its cleaning slot is absorbed by the upstream one).
   */
  private async mergeAcrossCancellation(t1: Turnover, t2: Turnover, tx: Tx): Promise<void> {
    // Supersede T1 with the merged endpoints (PREV → NEXT)
    await this.supersede(t1.id, {
      toBookingId: t2.toBookingId,
      dueBy: t2.dueBy,
    }, tx);

    // Mark T2 as SKIPPED. Don't delete — preserve audit trail.
    await tx.turnover.update({
      where: { id: t2.id },
      data: {
        status: 'SKIPPED',
        cancelledAt: new Date(),
      },
    });
  }

  // ==========================================================================
  // Primitives
  // ==========================================================================

  private async createTurnover(
    data: {
      tenantId: string;
      propertyId: string;
      fromBookingId: string | null;
      toBookingId: string | null;
      availableFrom: Date | null;
      dueBy: Date | null;
      isOwnerStay: boolean;
    },
    tx: Tx,
  ): Promise<Turnover> {
    return tx.turnover.create({
      data: {
        ...data,
        status: 'PENDING',
      },
    });
  }

  /**
   * Supersede an existing turnover (Decision 1B). The old record stays
   * intact for audit; a new one is created with the applied changes inheriting
   * everything else. Assignments and other ancillary state move to the new one.
   *
   * Returns the new (active) turnover.
   */
  private async supersede(
    oldId: string,
    changes: Partial<{
      fromBookingId: string | null;
      toBookingId: string | null;
      availableFrom: Date | null;
      dueBy: Date | null;
    }>,
    tx: Tx,
  ): Promise<Turnover> {
    const old = await tx.turnover.findUnique({
      where: { id: oldId },
      include: { assignments: true },
    });
    if (!old) {
      throw new Error(`Supersede: turnover ${oldId} not found`);
    }
    if (old.supersededById) {
      throw new Error(`Supersede: turnover ${oldId} is already superseded by ${old.supersededById}`);
    }

    const fresh = await tx.turnover.create({
      data: {
        tenantId: old.tenantId,
        propertyId: old.propertyId,
        fromBookingId: 'fromBookingId' in changes ? changes.fromBookingId! : old.fromBookingId,
        toBookingId:   'toBookingId'   in changes ? changes.toBookingId!   : old.toBookingId,
        availableFrom: 'availableFrom' in changes ? changes.availableFrom! : old.availableFrom,
        dueBy:         'dueBy'         in changes ? changes.dueBy!         : old.dueBy,
        status: old.status,
        startedAt: old.startedAt,
        completedAt: old.completedAt,
        cancelledAt: old.cancelledAt,
        completedAllGood: old.completedAllGood,
        maxCleaners: old.maxCleaners,
        managerNote: old.managerNote,
        cleanerNote: old.cleanerNote,
        supplyNote: old.supplyNote,
        isOwnerStay: old.isOwnerStay,
      },
    });

    await tx.turnover.update({
      where: { id: oldId },
      data: { supersededById: fresh.id },
    });

    // Move assignments to the new turnover. We don't delete the old rows
    // (assignments table has a unique constraint on (turnoverId, userId), so
    // we can't have duplicates). Instead, we move them via Cascade-safe
    // create-and-delete pattern.
    if (old.assignments.length > 0) {
      await tx.turnoverAssignment.deleteMany({
        where: { turnoverId: oldId },
      });
      for (const a of old.assignments) {
        await tx.turnoverAssignment.create({
          data: {
            turnoverId: fresh.id,
            userId: a.userId,
            assignedById: a.assignedById,
            isPrimary: a.isPrimary,
            status: a.status,
            rejectedReason: a.rejectedReason,
            startedAt: a.startedAt,
            completedAt: a.completedAt,
            assignedAt: a.assignedAt,
          },
        });
      }
    }

    return fresh;
  }

  /** Date comparison helper — both nullable, equal if both null or same epoch ms. */
  private notEqualTime(a: Date | null, b: Date | null): boolean {
    if (a === null && b === null) return false;
    if (a === null || b === null) return true;
    return a.getTime() !== b.getTime();
  }
}
