import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  PmsBooking, PmsAccommodation, PmsTenantConfig,
} from '../common/interfaces/pms-adapter.interface';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { BookingChannel, CleaningEventStatus, AssignmentStatus } from '@prisma/client';

export interface SyncResult {
  accommodations: { synced: number; created: number; updated: number };
  bookings: { created: number; updated: number; cancelled: number };
}

export interface PlanningFilters {
  arrivalFrom?: string;      // filters by checkInTime >=
  arrivalTo?: string;        // filters by checkInTime <=
  creationDateFrom?: string; // filters by event createdAt >=
  creationDateTo?: string;   // filters by event createdAt <=
  status?: string;           // CleaningEventStatus value
}

@Injectable()
export class BookingSyncService {
  private readonly logger = new Logger(BookingSyncService.name);

  constructor(
    private prisma: PrismaService,
    private avantioAdapter: AvantioAdapter,
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

    return { accommodations: accomResult, bookings: bookingResult };
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

    const events = await this.prisma.cleaningEvent.findMany({
      where,
      include: {
        property: { select: { id: true, name: true, pmsPropertyId: true } },
        assignments: {
          where: { status: { not: AssignmentStatus.REASSIGNED } },
          include: { user: { select: { id: true, name: true } } },
          orderBy: { isPrimary: 'desc' },
        },
      },
      orderBy: { checkInTime: 'asc' },
    });

    return events.map(e => ({
      id: e.id,
      pmsBookingId: e.pmsBookingId,
      bookingRef: e.bookingRef,
      accommodationName: e.accommodationName,
      accommodationType: e.accommodationType,
      propertyId: e.propertyId,
      pmsPropertyId: (e.property as any)?.pmsPropertyId,
      checkInTime: e.checkInTime,
      checkOutTime: e.checkOutTime,
      timeSlot: e.timeSlot,
      numAdults: e.numAdults,
      numChildren: e.numChildren,
      channel: e.channel,
      status: e.status,
      assignments: e.assignments.map((a: any) => ({
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
  ): Promise<{ success: boolean; eventId?: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) {
      throw new Error('PMS not configured for this tenant');
    }

    const config: PmsTenantConfig = { apiBaseUrl: tenant.pmsApiBaseUrl, apiKey: tenant.pmsApiKey };

    // Step 1: push to Avantio
    const adapter = this.getAdapter(tenant.pmsProvider || 'avantio');
    await adapter.updateBookingTimes(pmsBookingId, data, config);
    this.logger.log(`Planning: pushed updated times for booking ${pmsBookingId} to Avantio`);

    // Step 2: update local cleaning event
    const event = await this.prisma.cleaningEvent.findFirst({
      where: { tenantId, pmsBookingId },
      include: { assignments: true },
    });

    if (!event) {
      // No local event yet — next sync will create it with the correct times
      return { success: true };
    }

    await this.prisma.cleaningEvent.update({
      where: { id: event.id },
      data: {
        ...(data.checkInTime && { checkInTime: new Date(data.checkInTime) }),
        ...(data.checkOutTime && { checkOutTime: new Date(data.checkOutTime) }),
        pmsLastSyncedAt: new Date(),
      },
    });

    // Step 3: notify assigned cleaners
    for (const assignment of event.assignments) {
      if (['ASSIGNED', 'STARTED'].includes(assignment.status)) {
        await this.createNotification(
          tenantId,
          assignment.userId,
          'BOOKING_MODIFIED',
          'Check-in Time Updated',
          `The check-in time for ${event.accommodationName} has been updated. Please review your schedule.`,
          event.id,
        );
      }
    }

    return { success: true, eventId: event.id };
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

    // ── Resolve property from local DB (synced from accommodations) ──
    const property = await this.resolveProperty(tenantId, booking, adapter, config);

    // Check if event already exists
    const existing = await this.prisma.cleaningEvent.findFirst({
      where: { tenantId, pmsBookingId: booking.pmsBookingId },
      include: { assignments: true },
    });

    if (existing) {
      // Update PMS-owned fields only
      const hasChanges =
        existing.checkInTime.toISOString() !== new Date(booking.checkInTime).toISOString() ||
        (booking.checkOutTime && existing.checkOutTime?.toISOString() !== new Date(booking.checkOutTime).toISOString()) ||
        existing.numAdults !== booking.numAdults ||
        existing.numChildren !== booking.numChildren ||
        existing.accommodationName !== property.name;

      if (hasChanges) {
        await this.prisma.cleaningEvent.update({
          where: { id: existing.id },
          data: {
            checkInTime: new Date(booking.checkInTime),
            checkOutTime: booking.checkOutTime ? new Date(booking.checkOutTime) : undefined,
            accommodationName: property.name,
            accommodationType: property.accommodationType,
            numAdults: booking.numAdults,
            numChildren: booking.numChildren,
            channel: this.mapChannel(booking.channel),
            pmsLastSyncedAt: new Date(),
            pmsRawData: booking.rawData,
          },
        });

        // Notify assigned cleaners of changes
        if (existing.assignments.length > 0) {
          for (const assignment of existing.assignments) {
            if (['ASSIGNED', 'STARTED'].includes(assignment.status)) {
              await this.createNotification(tenantId, assignment.userId, 'BOOKING_MODIFIED',
                'Booking Updated', `Details changed for ${property.name}.`, existing.id);
            }
          }
        }

        return 'updated';
      }

      return 'skipped';
    }

    // ── Create new cleaning event ──
    const event = await this.prisma.cleaningEvent.create({
      data: {
        tenantId,
        propertyId: property.id,
        bookingRef: booking.bookingRef,
        pmsBookingId: booking.pmsBookingId,
        checkInTime: new Date(booking.checkInTime),
        checkOutTime: booking.checkOutTime ? new Date(booking.checkOutTime) : null,
        accommodationName: property.name,
        accommodationType: property.accommodationType,
        numAdults: booking.numAdults,
        numChildren: booking.numChildren,
        channel: this.mapChannel(booking.channel),
        cleaningType: 'CHECKOUT',
        status: 'PENDING',
        // Default time slot: checkout time or 3h before check-in
        timeSlot: booking.checkOutTime
          ? new Date(booking.checkOutTime)
          : new Date(new Date(booking.checkInTime).getTime() - 3 * 60 * 60 * 1000),
        pmsLastSyncedAt: new Date(),
        pmsRawData: booking.rawData,
      },
    });

    // Auto-assign if property has a default cleaner
    if (property.defaultCleanerId) {
      await this.prisma.cleaningAssignment.create({
        data: {
          cleaningEventId: event.id,
          userId: property.defaultCleanerId,
          isPrimary: true,
          status: 'ASSIGNED',
        },
      });

      await this.prisma.cleaningEvent.update({
        where: { id: event.id },
        data: { status: 'ASSIGNED' },
      });

      await this.createNotification(tenantId, property.defaultCleanerId, 'NEW_ASSIGNMENT',
        'New Cleaning', `New cleaning assigned: ${property.name}`, event.id);
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
   */
  private async handleCancellation(
    tenantId: string,
    booking: PmsBooking,
  ): Promise<'cancelled' | 'skipped'> {
    const existing = await this.prisma.cleaningEvent.findFirst({
      where: { tenantId, pmsBookingId: booking.pmsBookingId },
      include: { assignments: true },
    });

    if (!existing || existing.status === CleaningEventStatus.CANCELLED) return 'skipped';

    await this.prisma.cleaningEvent.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    await this.prisma.cleaningAssignment.updateMany({
      where: { cleaningEventId: existing.id, status: { in: ['ASSIGNED', 'STARTED'] } },
      data: { status: 'REASSIGNED' },
    });

    for (const assignment of existing.assignments) {
      if (['ASSIGNED', 'STARTED'].includes(assignment.status)) {
        await this.createNotification(tenantId, assignment.userId, 'CANCELLATION',
          'Cleaning Cancelled', `Cleaning for ${existing.accommodationName} was cancelled.`, existing.id);
      }
    }

    return 'cancelled';
  }

  /**
   * Push updated check-in/check-out times to Avantio.
   */
  async pushTimesToPms(tenantId: string, eventId: string) {
    const event = await this.prisma.cleaningEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event?.pmsBookingId) return;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.pmsApiBaseUrl || !tenant?.pmsApiKey) return;

    const config: PmsTenantConfig = {
      apiBaseUrl: tenant.pmsApiBaseUrl,
      apiKey: tenant.pmsApiKey,
    };

    const adapter = this.getAdapter(tenant.pmsProvider || 'avantio');
    await adapter.updateBookingTimes(event.pmsBookingId, {
      checkInTime: event.checkInTime.toISOString(),
      checkOutTime: event.checkOutTime?.toISOString(),
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