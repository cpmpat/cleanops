// backend/src/integrations/turnover-sync.service.ts
//
// Pure chain-manipulation service for the Turnover model. No knowledge of
// Avantio API; no notifications; no audit logging side-effects.
//
// All public methods accept a Prisma TransactionClient so callers can wrap
// chain manipulation in an outer transaction alongside other writes.

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

    // Idempotency check: only block if a NON-SKIPPED active turnover exists
    // for this booking. SKIPPED orphans should not prevent re-insertion.
    const existing = await tx.turnover.findFirst({
      where: {
        supersededById: null,
        status: { not: 'SKIPPED' },
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

  async onBookingCancelled(bookingId: string, tx: Tx): Promise<void> {
    const t1 = await tx.turnover.findFirst({
      where: { toBookingId: bookingId, supersededById: null, status: { not: 'SKIPPED' } },
    });
    const t2 = await tx.turnover.findFirst({
      where: { fromBookingId: bookingId, supersededById: null, status: { not: 'SKIPPED' } },
    });

    if (t1 && t2) {
      await this.mergeAcrossCancellation(t1, t2, tx);
    } else if (t1 && !t2) {
      await this.supersede(t1.id, { toBookingId: null, dueBy: null }, tx);
    } else if (!t1 && t2) {
      await this.supersede(t2.id, { fromBookingId: null, availableFrom: null }, tx);
    } else {
      this.logger.warn(`onBookingCancelled: no active turnovers found for booking ${bookingId}`);
    }
  }

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
      const t1 = await tx.turnover.findFirst({
        where: { toBookingId: booking.id, supersededById: null, status: { not: 'SKIPPED' } },
      });
      if (t1 && this.notEqualTime(t1.dueBy, booking.checkInTime)) {
        await this.supersede(t1.id, { dueBy: booking.checkInTime }, tx);
      }

      const t2 = await tx.turnover.findFirst({
        where: { fromBookingId: booking.id, supersededById: null, status: { not: 'SKIPPED' } },
      });
      if (t2 && this.notEqualTime(t2.availableFrom, booking.checkOutTime)) {
        await this.supersede(t2.id, { availableFrom: booking.checkOutTime }, tx);
      }
    } else {
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

  private async insertBetween(K: Booking, prev: Booking, next: Booking, tx: Tx): Promise<void> {
    const existing = await tx.turnover.findFirst({
      where: {
        fromBookingId: prev.id,
        toBookingId: next.id,
        supersededById: null,
      },
    });

    let prevToK: Turnover;
    if (existing) {
      prevToK = await this.supersede(existing.id, {
        toBookingId: K.id,
        dueBy: K.checkInTime,
      }, tx);
    } else {
      prevToK = await this.createTurnover({
        tenantId: K.tenantId,
        propertyId: K.propertyId,
        fromBookingId: prev.id,
        toBookingId: K.id,
        availableFrom: prev.checkOutTime,
        dueBy: K.checkInTime,
        isOwnerStay: K.isOwnerStay,
      }, tx);
    }

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
   * FIXED: T2 now gets `supersededById` set to the merged turnover so it's
   * properly retired from "active" queries. Requires @unique to be dropped
   * from supersededById in the schema migration.
   */
  private async mergeAcrossCancellation(t1: Turnover, t2: Turnover, tx: Tx): Promise<void> {
    // Supersede T1 with the merged endpoints (PREV → NEXT). This creates
    // a new active turnover that absorbs both T1 and T2's role.
    const merged = await this.supersede(t1.id, {
      toBookingId: t2.toBookingId,
      dueBy: t2.dueBy,
    }, tx);

    // T2 is no longer a separate cleaning slot. Mark SKIPPED for audit and
    // CRUCIALLY set supersededById so "active" queries no longer match it.
    await tx.turnover.update({
      where: { id: t2.id },
      data: {
        status: 'SKIPPED',
        cancelledAt: new Date(),
        supersededById: merged.id,
      },
    });
  }

  // ==========================================================================
  // Primitives
  // ==========================================================================

  /**
   * Create a new active turnover. Always followed by enforceUniqueActive
   * to guard against orphaned active duplicates from race conditions or
   * earlier bugs.
   */
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
    const fresh = await tx.turnover.create({
      data: {
        ...data,
        status: 'PENDING',
      },
    });
    await this.enforceUniqueActive(fresh, tx);
    return fresh;
  }

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

    await this.enforceUniqueActive(fresh, tx);
    return fresh;
  }

  /**
   * NEW: Ensure no other active turnover at the same property shares the
   * newly-created/superseded turnover's fromBookingId or toBookingId.
   * Any conflicting active record is marked superseded by this one.
   *
   * Only enforces uniqueness on NON-NULL endpoints — multiple leading or
   * trailing null turnovers per property are not policed here.
   */
  private async enforceUniqueActive(newTurnover: Turnover, tx: Tx): Promise<void> {
    const conflicts: any[] = [];
    if (newTurnover.toBookingId) {
      conflicts.push({ toBookingId: newTurnover.toBookingId });
    }
    if (newTurnover.fromBookingId) {
      conflicts.push({ fromBookingId: newTurnover.fromBookingId });
    }
    if (conflicts.length === 0) return;

    const orphans = await tx.turnover.findMany({
      where: {
        propertyId: newTurnover.propertyId,
        supersededById: null,
        id: { not: newTurnover.id },
        OR: conflicts,
      },
    });

    if (orphans.length === 0) return;

    this.logger.warn(
      `enforceUniqueActive: superseding ${orphans.length} orphaned active turnover(s) ` +
      `(property=${newTurnover.propertyId}, new=${newTurnover.id})`,
    );

    for (const orphan of orphans) {
      await tx.turnover.update({
        where: { id: orphan.id },
        data: { supersededById: newTurnover.id },
      });
    }
  }

  private notEqualTime(a: Date | null, b: Date | null): boolean {
    if (a === null && b === null) return false;
    if (a === null || b === null) return true;
    return a.getTime() !== b.getTime();
  }
}
