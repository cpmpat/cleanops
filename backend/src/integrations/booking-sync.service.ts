import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  PmsBooking, PmsAccommodation, PmsTenantConfig,
} from '../common/interfaces/pms-adapter.interface';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { BookingChannel, BookingStatus, CleaningStatus, AssignmentStatus } from '@prisma/client';
import { GcsService } from '../storage/gcs.service';

export interface SyncResult {
  accommodations: { synced: number; created: number; updated: number };
  bookings: { created: number; updated: number; cancelled: number };
}

export interface PlanningFilters {
  arrivalFrom?: string;      // filters by checkInTime >=
  arrivalTo?: string;        // filters by checkInTime <=
  creationDateFrom?: string; // filters by event createdAt >=
  creationDateTo?: string;   // filters by event createdAt <=
  status?: string;           // CleaningStatus value
}

@Injectable()
export class BookingSyncService {
  private readonly logger = new Logger(BookingSyncService.name);

  constructor(
    private prisma: PrismaService,
    private avantioAdapter: AvantioAdapter,
    private gcs: GcsService,
  ) {}

  /**
   * Full sync for a tenant:
   *  1. Sync accommodations (properties) — names, types, statuses
   *  2. Sync bookings — create/update/cancel cleaning events
   */
  async syncTenant(tenantId: string): Promise<SyncResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || !tenant.pmsSyncEnabled || !tenant.pmsApiBaseUrl || !tenant.pmsApiKey) {
      this.logger.warn(`Tenant ${tenantId} sync skipped: not configured`);
      return {
        accommodations: { synced: 0, created: 0, updated: 0 },
        bookings: { created: 0, updated: 0, cancelled: 0 },
      };
    }

    const config: PmsTenantConfig = {
      apiBaseUrl: tenant.pmsApiBaseUrl,
      apiKey: tenant.pmsApiKey,
    };

    const adapter = this.getAdapter(tenant.pmsProvider || 'avantio');

    // ── Step 1: Sync accommodations ──
    const accomResult = await this.syncAccommodations(tenantId, adapter, config);

    // ── Step 2: Sync bookings ──
    const since = tenant.pmsLastSyncAt || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const bookingResult = await this.syncBookings(tenantId, adapter, config, since);

    // Update last sync timestamp
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { pmsLastSyncAt: new Date() },
    });

    this.logger.log(
      `[${tenant.name}] Sync complete: ` +
      `${accomResult.created} new properties, ${accomResult.updated} updated | ` +
      `${bookingResult.created} new events, ${bookingResult.updated} updated, ${bookingResult.cancelled} cancelled`
    );

    // Bulk reconcile previous-guest-checkout column on all cleanings for this tenant.
    // Catches edge cases from cancellations, mid-period inserts, etc.
    try {
      const updated = await this.reconcilePreviousGuestCheckOut(tenantId);
      if (updated > 0) {
        this.logger.log(`[${tenant.name}] Reconciled previousGuestCheckOutTime on ${updated} cleanings`);
      }
    } catch (e) {
      this.logger.warn(`[${tenant.name}] Reconcile failed: ${(e as Error).message}`);
    }

    return { accommodations: accomResult, bookings: bookingResult };
  }

  /**
   * Bulk-update `previousGuestCheckOutTime` on every cleaning for this tenant
   * based on prior CONFIRMED bookings at the same property. The previous
   * booking is the one that STARTED most recently before this booking — we
   * take its checkout time. This correctly handles bookings with small
   * overlaps from midnight check-ins.
   * Idempotent; only touches rows whose computed value differs from the
   * stored one. Returns the number of rows actually updated.
   */
  private async reconcilePreviousGuestCheckOut(tenantId: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      WITH computed AS (
        SELECT c.id,
          (SELECT b."checkOutTime" FROM "bookings" b
           WHERE b."propertyId" = c."propertyId"
             AND b."checkInTime" < c."checkInTime"
             AND b."status" = 'CONFIRMED'
             AND b.id != c."bookingId"
           ORDER BY b."checkInTime" DESC
           LIMIT 1
          ) AS prev
        FROM "cleanings" c
        WHERE c."tenantId" = ${tenantId}
      )
      UPDATE "cleanings" c
      SET "previousGuestCheckOutTime" = computed.prev
      FROM computed
      WHERE c.id = computed.id
        AND c."previousGuestCheckOutTime" IS DISTINCT FROM computed.prev
    `;
    return Number(result) || 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // CHECK-IN PLANNING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fetch bookings for the Check-in Planning view.
   * Uses the local cleaning_events table (populated by PMS sync) so the
   * response is instant. Each record includes the assignment summary.
   */
  async getBookingsForPlanning(tenantId: string, filters: PlanningFilters) {
    const where: any = { tenantId };

    if (filters.arrivalFrom || filters.arrivalTo) {
      where.checkInTime = {};
      if (filters.arrivalFrom) where.checkInTime.gte = new Date(filters.arrivalFrom);
      if (filters.arrivalTo) where.checkInTime.lte = new Date(filters.arrivalTo);
    }

    if (filters.creationDateFrom || filters.creationDateTo) {
      where.createdAt = {};
      if (filters.creationDateFrom) where.createdAt.gte = new Date(filters.creationDateFrom);
      if (filters.creationDateTo) where.createdAt.lte = new Date(filters.creationDateTo);
    }

    if (filters.status) where.status = filters.status;

    const bookings = await this.prisma.booking.findMany({
      where,
      include: {
        property: { select: { id: true, name: true, pmsPropertyId: true } },
        cleaning: {
          include: {
            assignments: {
              where: { status: { not: AssignmentStatus.REASSIGNED } },
              include: { user: { select: { id: true, name: true } } },
              orderBy: { isPrimary: 'desc' },
            },
          },
        },
      },
      orderBy: { checkInTime: 'asc' },
    });

    return bookings.map(b => ({
      id: b.id,
      cleaningId: b.cleaning?.id,
      pmsBookingId: b.pmsBookingId,
      bookingRef: b.bookingRef,
      accommodationName: b.accommodationName,
      accommodationType: b.accommodationType,
      propertyId: b.propertyId,
      pmsPropertyId: (b.property as any)?.pmsPropertyId,
      checkInTime: b.checkInTime,
      checkOutTime: b.checkOutTime,
      timeSlot: b.cleaning?.timeSlot,
      numAdults: b.numAdults,
      numChildren: b.numChildren,
      channel: b.channel,
      status: b.cleaning?.status,
      bookingStatus: b.status,
      bookingCancelledAt: b.cancelledAt,
      assignments: (b.cleaning?.assignments ?? []).map((a: any) => ({
        id: a.id,
        userId: a.userId,
        userName: a.user.name,
        isPrimary: a.isPrimary,
        status: a.status,
      })),
    }));
  }

  /**
   * Fetch full booking detail from Avantio for the planning edit modal.
   */
  async getBookingDetail(tenantId: string, pmsBookingId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) {
      throw new Error('PMS not configured for this tenant');
    }
    const config: PmsTenantConfig = { apiBaseUrl: tenant.pmsApiBaseUrl, apiKey: tenant.pmsApiKey };
    return this.avantioAdapter.getBooking(pmsBookingId, config);
  }

  /**
   * Update check-in / check-out times from the planning view.
   *
   * 1. PUT to Avantio — source of truth is updated first
   * 2. Update local cleaning event — avoids a 5-min stale window
   * 3. Notify assigned cleaners — they need to know their schedule changed
   */
  async updateBookingTimesFromPlanning(
    tenantId: string,
    pmsBookingId: string,
    data: { checkInTime?: string; checkOutTime?: string },
  ): Promise<{ success: boolean; bookingId?: string; cleaningId?: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) {
      throw new Error('PMS not configured for this tenant');
    }

    const config: PmsTenantConfig = { apiBaseUrl: tenant.pmsApiBaseUrl, apiKey: tenant.pmsApiKey };

    // Step 1: push to Avantio
    const adapter = this.getAdapter(tenant.pmsProvider || 'avantio');
    await adapter.updateBookingTimes(pmsBookingId, data, config);
    this.logger.log(`Planning: pushed updated times for booking ${pmsBookingId} to Avantio`);

    // Step 2: update local Booking + propagate to Cleaning
    const b = await this.prisma.booking.findFirst({
      where: { tenantId, pmsBookingId },
      include: {
        cleaning: { include: { assignments: true } },
      },
    });

    if (!b) {
      // No local booking yet — next sync will create it with the correct times
      return { success: true };
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          ...(data.checkInTime && { checkInTime: new Date(data.checkInTime) }),
          ...(data.checkOutTime && { checkOutTime: new Date(data.checkOutTime) }),
          pmsLastSyncedAt: now,
        },
      });

      if (b.cleaning) {
        await tx.cleaning.update({
          where: { id: b.cleaning.id },
          data: {
            ...(data.checkInTime && { checkInTime: new Date(data.checkInTime) }),
            ...(data.checkOutTime && { checkOutTime: new Date(data.checkOutTime) }),
            // Keep timeSlot in sync with the incoming guest's check-in.
            // Under the new model, timeSlot mirrors checkInTime.
            ...(data.checkInTime && { timeSlot: new Date(data.checkInTime) }),
            pmsLastSyncedAt: now,
          },
        });
      }
    });

    // Step 3: notify assigned cleaners
    if (b.cleaning?.assignments) {
      for (const a of b.cleaning.assignments) {
        if (['ASSIGNED', 'STARTED'].includes(a.status)) {
          await this.createNotification(
            tenantId, a.userId, 'BOOKING_MODIFIED',
            'Check-in Time Updated',
            `The check-in time for ${b.accommodationName} has been updated. Please review your schedule.`,
            b.cleaning.id,
          );
        }
      }
    }

    return { success: true, bookingId: b.id, cleaningId: b.cleaning?.id };
  }

  // ═══════════════════════════════════════════════════════════════
  // ACCOMMODATION SYNC
  // ═══════════════════════════════════════════════════════════════

  /**
   * Syncs accommodations from Avantio to the local properties table.
   *
   * For each Avantio accommodation:
   *  - If property exists (by pmsPropertyId): update name, type, status, clean flag
   *  - If not: create new property
   *
   * This runs BEFORE booking sync so that when we process bookings,
   * we can look up accommodation.id → property name/type locally.
   */
  private async syncAccommodations(
    tenantId: string,
    adapter: AvantioAdapter,
    config: PmsTenantConfig,
  ): Promise<{ synced: number; created: number; updated: number }> {
    let accommodations: PmsAccommodation[];
    try {
      accommodations = await adapter.pullAccommodations(config);
    } catch (err) {
      this.logger.error(`Failed to pull accommodations: ${err.message}`);
      return { synced: 0, created: 0, updated: 0 };
    }

    let created = 0, updated = 0;

    for (const accom of accommodations) {
      try {
        const existing = await this.prisma.property.findFirst({
          where: { tenantId, pmsPropertyId: accom.pmsId },
        });

        if (existing) {
          // Update name, type, status, clean flag
          const hasChanges =
            existing.name !== accom.name ||
            existing.accommodationType !== accom.type ||
            existing.pmsStatus !== accom.status ||
            existing.pmsClean !== accom.clean;

          if (hasChanges) {
            await this.prisma.property.update({
              where: { id: existing.id },
              data: {
                name: accom.name,
                accommodationType: accom.type,
                pmsStatus: accom.status,
                pmsClean: accom.clean,
                pmsLastSyncedAt: new Date(),
                // Deactivate if Avantio marks as DISABLED/DELETED
                isActive: accom.status === 'ENABLED',
              },
            });
            updated++;
          }

          // Ensure the bucket folder placeholder exists (idempotent — no-op
          // if already present). Catches gaps where a property was created
          // before the GCS feature was deployed.
          this.gcs
            .createPropertyFolderPlaceholder(accom.pmsId)
            .catch((err) =>
              this.logger.warn(
                `GCS placeholder failed for ${accom.pmsId}: ${err?.message}`,
              ),
            );
        } else {
          // Create new property
          await this.prisma.property.create({
            data: {
              tenantId,
              name: accom.name,
              pmsPropertyId: accom.pmsId,
              accommodationType: accom.type,
              pmsStatus: accom.status,
              pmsClean: accom.clean,
              pmsLastSyncedAt: new Date(),
              isActive: accom.status === 'ENABLED',
            },
          });
          created++;

          // Pre-create the GCS folder so it's visible in the bucket browser
          // immediately. Non-blocking — sync continues even if GCS fails.
          this.gcs
            .createPropertyFolderPlaceholder(accom.pmsId)
            .catch((err) =>
              this.logger.warn(
                `GCS placeholder failed for ${accom.pmsId}: ${err?.message}`,
              ),
            );
        }
      } catch (err) {
        this.logger.warn(`Failed to sync accommodation ${accom.pmsId}: ${err.message}`);
      }
    }

    return { synced: accommodations.length, created, updated };
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOKING SYNC
  // ═══════════════════════════════════════════════════════════════

  private async syncBookings(
    tenantId: string,
    adapter: AvantioAdapter,
    config: PmsTenantConfig,
    since: Date,
  ): Promise<{ created: number; updated: number; cancelled: number }> {
    let bookings: PmsBooking[];
    try {
      bookings = await adapter.pullBookings(since, config);
    } catch (err) {
      this.logger.error(`Failed to pull bookings: ${err.message}`);
      return { created: 0, updated: 0, cancelled: 0 };
    }

    let created = 0, updated = 0, cancelled = 0;

    for (const booking of bookings) {
      try {
        // Pass adapter + config so processBooking can live-fetch a missing property
        const result = await this.processBooking(tenantId, booking, adapter, config);
        if (result === 'created') created++;
        if (result === 'updated') updated++;
        if (result === 'cancelled') cancelled++;
      } catch (err) {
        this.logger.error(`Failed to process booking ${booking.pmsBookingId}: ${err.message}`);
      }
    }

    return { created, updated, cancelled };
  }

  /**
   * Process a single booking from the PMS.
   * Resolves accommodation.id → property name/type from local properties table,
   * falling back to a live Avantio fetch if the property isn't found locally.
   */
  private async processBooking(
    tenantId: string,
    booking: PmsBooking,
    adapter: AvantioAdapter,
    config: PmsTenantConfig,
  ): Promise<'created' | 'updated' | 'cancelled' | 'skipped'> {
    // Handle cancellations
    if (booking.status === 'cancelled') {
      return this.handleCancellation(tenantId, booking);
    }

    // ── Resolve property from local DB ──
    const property = await this.resolveProperty(tenantId, booking, adapter, config);

    // ── Check if Booking already exists ──
    const existing = await this.prisma.booking.findFirst({
      where: { tenantId, pmsBookingId: booking.pmsBookingId },
      include: {
        cleaning: { include: { assignments: true } },
      },
    });

    if (existing) {
      const incomingOwnerFlag = booking.isOwnerStay ?? false;
      // Update PMS-owned fields on Booking + propagate denormalized to Cleaning
      const hasChanges =
        existing.checkInTime.toISOString() !== new Date(booking.checkInTime).toISOString() ||
        (booking.checkOutTime && existing.checkOutTime?.toISOString() !== new Date(booking.checkOutTime).toISOString()) ||
        existing.numAdults !== booking.numAdults ||
        existing.numChildren !== booking.numChildren ||
        existing.accommodationName !== property.name ||
        existing.isOwnerStay !== incomingOwnerFlag;

      if (hasChanges) {
        const now = new Date();
        const checkIn = new Date(booking.checkInTime);
        const checkOut = booking.checkOutTime ? new Date(booking.checkOutTime) : null;

        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: existing.id },
            data: {
              checkInTime: checkIn,
              checkOutTime: checkOut,
              accommodationName: property.name,
              accommodationType: property.accommodationType,
              numAdults: booking.numAdults,
              numChildren: booking.numChildren,
              channel: this.mapChannel(booking.channel),
              pmsLastSyncedAt: now,
              pmsRawData: booking.rawData,
              isOwnerStay: incomingOwnerFlag,
            },
          });

          if (existing.cleaning) {
            await tx.cleaning.update({
              where: { id: existing.cleaning.id },
              data: {
                bookingRef: booking.bookingRef,
                checkInTime: checkIn,
                checkOutTime: checkOut,
                // Keep timeSlot in sync with the incoming guest's check-in.
                // Under the new model, timeSlot mirrors checkInTime.
                timeSlot: checkIn,
                accommodationName: property.name,
                numAdults: booking.numAdults,
                numChildren: booking.numChildren,
                channel: this.mapChannel(booking.channel),
                pmsLastSyncedAt: now,
                isOwnerStay: incomingOwnerFlag,
              },
            });
          }
        });

        // Notify assigned cleaners
        if (existing.cleaning?.assignments?.length) {
          for (const a of existing.cleaning.assignments) {
            if (['ASSIGNED', 'STARTED'].includes(a.status)) {
              await this.createNotification(
                tenantId, a.userId, 'BOOKING_MODIFIED',
                'Booking Updated', `Details changed for ${property.name}.`,
                existing.cleaning.id,
              );
            }
          }
        }

        return 'updated';
      }

      return 'skipped';
    }

    // ── Create new Booking + linked Cleaning in a single transaction ──
    const checkIn = new Date(booking.checkInTime);
    const checkOut = booking.checkOutTime ? new Date(booking.checkOutTime) : null;
    const syncedAt = new Date();

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
      const newBooking = await tx.booking.create({
        data: {
          tenantId,
          propertyId: property.id,
          bookingRef: booking.bookingRef,
          pmsBookingId: booking.pmsBookingId,
          status: BookingStatus.CONFIRMED,
          checkInTime: checkIn,
          checkOutTime: checkOut,
          accommodationName: property.name,
          accommodationType: property.accommodationType,
          numAdults: booking.numAdults,
          numChildren: booking.numChildren,
          channel: this.mapChannel(booking.channel),
          pmsLastSyncedAt: syncedAt,
          pmsRawData: booking.rawData,
          isOwnerStay: booking.isOwnerStay ?? false,
        },
      });
      // Cleaning is preparation for the incoming guest.
      // timeSlot equals the booking's check-in time — that's the deadline by
      // which the unit must be ready. The cleaner decides her own start time
      // based on the previous-guest checkout (denormalized as previousGuestCheckOutTime).
      const defaultTimeSlot = checkIn;

      // Look up the booking that STARTED most recently before this one at
      // the same property. Its checkout time is the previous-guest checkout.
      // This handles small overlaps caused by midnight-check-in conventions.
      const priorBooking = await tx.booking.findFirst({
        where: {
          propertyId: property.id,
          tenantId,
          status: 'CONFIRMED',
          checkInTime: { lt: checkIn },
          NOT: { id: newBooking.id },
        },
        orderBy: { checkInTime: 'desc' },
        select: { checkOutTime: true },
      });

      const newCleaning = await tx.cleaning.create({
        data: {
          tenantId,
          propertyId: property.id,
          bookingId: newBooking.id,
          cleaningType: 'CHECKOUT',
          status: CleaningStatus.PENDING,
          timeSlot: defaultTimeSlot,
          maxCleaners: 1,
          // Denormalized booking fields
          bookingRef: booking.bookingRef,
          checkInTime: checkIn,
          checkOutTime: checkOut,
          accommodationName: property.name,
          numAdults: booking.numAdults,
          numChildren: booking.numChildren,
          channel: this.mapChannel(booking.channel),
          pmsLastSyncedAt: syncedAt,
          previousGuestCheckOutTime: priorBooking?.checkOutTime ?? null,
          isOwnerStay: booking.isOwnerStay ?? false,
        },
      });

      // Auto-assign if property has a default cleaner
      if (property.defaultCleanerId) {
        await tx.cleaningAssignment.create({
          data: {
            cleaningId: newCleaning.id,
            userId: property.defaultCleanerId,
            isPrimary: true,
            status: AssignmentStatus.ASSIGNED,
          },
        });
        await tx.cleaning.update({
          where: { id: newCleaning.id },
          data: { status: CleaningStatus.ASSIGNED },
        });
      }

      return { booking: newBooking, cleaning: newCleaning };
    });
    } catch (e: any) {
      // Race condition: another sync run created this booking between our
      // findFirst() and create(). Fall back to the update path.
      if (e?.code === 'P2002') {
        this.logger.warn(
          `Booking ${booking.pmsBookingId} was created concurrently — retrying as update`,
        );
        // Recursive retry: findFirst will now succeed and take the update branch
        return this.processBooking(tenantId, booking, adapter, config);
      }
      throw e;
    }

    // Out-of-transaction notification
    if (property.defaultCleanerId) {
      await this.createNotification(
        tenantId, property.defaultCleanerId, 'NEW_ASSIGNMENT',
        'New Cleaning', `New cleaning assigned: ${property.name}`,
        created.cleaning.id,
      );
    }

    return 'created';
  }

  /**
   * Resolve the property for a booking using a three-step strategy:
   *
   *  1. Local DB lookup by pmsPropertyId  — fast path, covers the vast majority
   *  2. Live fetch from GET /accommodations/{id}  — catches DISABLED units or
   *     accommodations created in Avantio after the last accommodations sync;
   *     upserts the result so subsequent bookings for the same unit hit step 1
   *  3. Placeholder creation  — last resort so the booking is never silently
   *     dropped; logged as a warning so it's easy to spot in monitoring
   */
  private async resolveProperty(
    tenantId: string,
    booking: PmsBooking,
    adapter: AvantioAdapter,
    config: PmsTenantConfig,
  ) {
    // ── Step 1: local DB lookup ──
    if (booking.pmsPropertyId) {
      const local = await this.prisma.property.findFirst({
        where: { tenantId, pmsPropertyId: booking.pmsPropertyId },
      });
      if (local) return local;
    }

    // ── Step 2: live fetch from Avantio ──
    if (booking.pmsPropertyId) {
      this.logger.warn(
        `Property ${booking.pmsPropertyId} not in local DB — ` +
        `attempting live fetch from Avantio (booking ${booking.pmsBookingId})`,
      );

      const accom = await adapter.getAccommodation(booking.pmsPropertyId, config);

      if (accom) {
        // Upsert so the next booking for this property skips the live fetch
        const upserted = await this.prisma.property.upsert({
          where: {
            // Compound unique index expected on (tenantId, pmsPropertyId)
            tenantId_pmsPropertyId: { tenantId, pmsPropertyId: accom.pmsId },
          },
          update: {
            name: accom.name,
            accommodationType: accom.type,
            pmsStatus: accom.status,
            pmsClean: accom.clean,
            pmsLastSyncedAt: new Date(),
            isActive: accom.status === 'ENABLED',
          },
          create: {
            tenantId,
            name: accom.name,
            pmsPropertyId: accom.pmsId,
            accommodationType: accom.type,
            pmsStatus: accom.status,
            pmsClean: accom.clean,
            pmsLastSyncedAt: new Date(),
            isActive: accom.status === 'ENABLED',
          },
        });

        this.logger.log(
          `Live-fetched and upserted property ${accom.pmsId} ("${accom.name}") ` +
          `for booking ${booking.pmsBookingId}`,
        );

        return upserted;
      }
    }

    // ── Step 3: placeholder fallback ──
    // Avantio returned nothing for this ID — create a minimal record so the
    // booking isn't dropped entirely. Flag it clearly for manual review.
    this.logger.warn(
      `Could not resolve property ${booking.pmsPropertyId} from Avantio — ` +
      `creating placeholder for booking ${booking.pmsBookingId}`,
    );

    return this.prisma.property.create({
      data: {
        tenantId,
        name: `Unknown Property (${booking.pmsPropertyId})`,
        pmsPropertyId: booking.pmsPropertyId || null,
        accommodationType: 'UNKNOWN',
        pmsStatus: 'UNKNOWN',
        isActive: false,
      },
    });
  }

  /**
   * Handle a cancelled booking.
   * Booking → status=CANCELLED.
   * Cleaning → bookingCancelledAt set, but cleaning itself NOT cancelled
   * (the unit may still need cleaning after a no-show/cancellation).
   * Assigned cleaners are notified informally so they know the context changed.
   */
  private async handleCancellation(
    tenantId: string,
    booking: PmsBooking,
  ): Promise<'cancelled' | 'skipped'> {
    const existing = await this.prisma.booking.findFirst({
      where: { tenantId, pmsBookingId: booking.pmsBookingId },
      include: {
        cleaning: { include: { assignments: true } },
      },
    });

    if (!existing || existing.status === BookingStatus.CANCELLED) return 'skipped';

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: existing.id },
        data: { status: BookingStatus.CANCELLED, cancelledAt: now },
      });

      if (existing.cleaning) {
        await tx.cleaning.update({
          where: { id: existing.cleaning.id },
          data: { bookingCancelledAt: now },
        });
      }

      // Audit trail: record the status flip from PMS sync
      await tx.auditEvent.create({
        data: {
          tenantId,
          category: 'PMS_SYNC' as any,
          action: 'booking.cancelled_via_sync',
          actorId: null,
          actorEmail: 'avantio-sync@cleanops',
          targetType: 'Booking',
          targetId: existing.id,
          metadata: {
            pmsBookingId: booking.pmsBookingId,
            bookingRef: existing.bookingRef,
            accommodationName: existing.accommodationName,
            cleaningId: existing.cleaning?.id ?? null,
            cleaningStatus: existing.cleaning?.status ?? null,
            previousStatus: 'CONFIRMED',
          } as any,
        },
      });
    });

    if (existing.cleaning?.assignments?.length) {
      for (const a of existing.cleaning.assignments) {
        if (['ASSIGNED', 'STARTED'].includes(a.status)) {
          await this.createNotification(
            tenantId, a.userId, 'CANCELLATION',
            'Booking Cancelled',
            `The booking for ${existing.accommodationName} was cancelled. ` +
            `The cleaning is still scheduled \u2014 check with the manager.`,
            existing.cleaning.id,
          );
        }
      }
    }

    // Notify all managers for this tenant — they need to decide if the cleaning
    // should be reassigned, released to pool, or cancelled entirely.
    const managers = await this.prisma.user.findMany({
      where: { tenantId, role: 'MANAGER', isActive: true },
      select: { id: true },
    });
    for (const m of managers) {
      await this.createNotification(
        tenantId, m.id, 'CANCELLATION',
        'Booking cancelled in Avantio',
        `${existing.accommodationName} \u2014 booking ${existing.bookingRef} was cancelled. ` +
        `The linked cleaning may need to be reassigned, released, or cancelled.`,
        existing.cleaning?.id ?? '',
      );
    }

    return 'cancelled';
  }

  /**
   * Push updated check-in/check-out times to Avantio.
   */
  async pushTimesToPms(tenantId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
    });
    if (!b?.pmsBookingId) return;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) return;

    const config: PmsTenantConfig = {
      apiBaseUrl: tenant.pmsApiBaseUrl,
      apiKey: tenant.pmsApiKey,
    };

    const adapter = this.getAdapter(tenant.pmsProvider || 'avantio');
    await adapter.updateBookingTimes(b.pmsBookingId, {
      checkInTime: b.checkInTime.toISOString(),
      checkOutTime: b.checkOutTime?.toISOString(),
    }, config);
  }

  /**
   * Sync only accommodations (useful for initial setup or manual refresh).
   */
  async syncAccommodationsOnly(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) return { synced: 0, created: 0, updated: 0 };

    const config: PmsTenantConfig = { apiBaseUrl: tenant.pmsApiBaseUrl, apiKey: tenant.pmsApiKey };
    return this.syncAccommodations(tenantId, this.getAdapter(tenant.pmsProvider || 'avantio'), config);
  }

  // ─── Helpers ───

  private async createNotification(
    tenantId: string, userId: string, type: string,
    title: string, body: string, eventId: string,
  ) {
    await this.prisma.notification.create({
      data: {
        tenantId, userId,
        type: type as any,
        channel: 'IN_APP',
        title, body,
        payload: { eventId },
      },
    });
  }

  private getAdapter(provider: string): AvantioAdapter {
    // Add more adapters here when needed
    return this.avantioAdapter;
  }

  private mapChannel(channel: string): BookingChannel {
    const l = channel.toLowerCase();
    if (l.includes('airbnb')) return 'AIRBNB';
    if (l.includes('booking')) return 'BOOKING_COM';
    if (l.includes('vrbo')) return 'VRBO';
    if (l.includes('expedia')) return 'EXPEDIA';
    if (l.includes('direct')) return 'DIRECT';
    return 'OTHER';
  }
}