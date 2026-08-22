import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import {
  PmsBooking, PmsAccommodation, PmsTenantConfig,
} from '../common/interfaces/pms-adapter.interface';
import { AvantioAdapter } from './avantio/avantio.adapter';
import { TurnoverSyncService } from './turnover-sync.service';
import { CleanOpsGateway } from '../websocket/websocket.module';
import { Prisma, BookingChannel, BookingStatus, CleaningStatus, AssignmentStatus } from '@prisma/client';
import { GcsService } from '../storage/gcs.service';

export interface SyncResult {
  accommodations: { synced: number; created: number; updated: number };
  bookings: { created: number; updated: number; cancelled: number };
}

/** Outcome of processing one PMS booking, per pmsBookingId. */
export interface BookingSyncOutcome {
  pmsBookingId: string;
  result: 'created' | 'updated' | 'cancelled' | 'skipped' | 'error';
  /** Why it was skipped, or what changed, in one line. */
  detail?: string;
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

  /**
   * Set only inside runWithoutNotifications(). Process-local by design: it is
   * a field on a singleton, so it would suppress notifications for concurrent
   * HTTP traffic too. That is why the guard below refuses to engage unless the
   * process was started as a script.
   */
  private notificationsSuppressed = false;

  constructor(
    private prisma: PrismaService,
    private avantioAdapter: AvantioAdapter,
    private gcs: GcsService,
    private turnoverSync: TurnoverSyncService,
    // Optional on purpose. The maintenance scripts boot a minimal Nest context
    // (scripts/lib/script-context.ts) that has no WebsocketModule, and a
    // required dependency would make every script fail to start. Absent here
    // is also the behaviour we want: a backfill must not push a refresh at
    // every open client.
    @Optional() private readonly gateway?: CleanOpsGateway,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  // TURNOVER SYNC (Phase 2 — feature-flagged dual-write)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Run `fn` with notification creation disabled.
   *
   * A backfill of a few thousand historical bookings would otherwise generate a
   * NEW_ASSIGNMENT row per auto-assigned cleaning and push all of them at the
   * cleaning staff. Refuses to run in the API process, where the flag would
   * leak across concurrent requests.
   */
  async runWithoutNotifications<T>(fn: () => Promise<T>): Promise<T> {
    if (process.env.CLEANOPS_SCRIPT_MODE !== 'true') {
      throw new Error(
        'runWithoutNotifications() is only allowed in script processes ' +
        '(CLEANOPS_SCRIPT_MODE=true). In a server process it would suppress ' +
        'notifications for concurrent requests.',
      );
    }
    this.notificationsSuppressed = true;
    try {
      return await fn();
    } finally {
      this.notificationsSuppressed = false;
    }
  }

  /**
   * Whether to write to the new Turnover model alongside Cleaning.
   * Controlled by env var TURNOVER_SYNC_ENABLED ('true' to enable).
   * Defaults to disabled — safe to deploy this code without affecting prod.
   */
  private isTurnoverSyncEnabled(): boolean {
    return process.env.TURNOVER_SYNC_ENABLED === 'true';
  }

  /**
   * Wrap a turnover sync operation so:
   *   1. It only runs when the feature flag is on
   *   2. Errors are logged but never re-thrown — turnover bugs cannot
   *      break cleaning sync (which is still the source of truth)
   *   3. Each operation gets its own atomic transaction
   */
  private async safelyRunTurnoverSync(
    label: string,
    operation: (tx: any) => Promise<void>,
  ): Promise<void> {
    if (!this.isTurnoverSyncEnabled()) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await operation(tx);
      });
    } catch (err) {
      this.logger.error(
        `Turnover sync [${label}] failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Intentionally swallow — Cleaning is source of truth during Phase 2 dual-write
    }
  }

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
      const updated = await this.reconcilePreviousGuestCheckOut(tenantId, 60);
      if (updated > 0) {
        this.logger.log(`[${tenant.name}] Reconciled previousGuestCheckOutTime on ${updated} cleanings`);
      }
    } catch (e) {
      this.logger.warn(`[${tenant.name}] Reconcile failed: ${(e as Error).message}`);
    }

    // ── Tell every open client the schedule moved ──
    //
    // Human-driven changes already broadcast: TurnoversService.claim/drop/etc
    // hold the gateway and emit, which is why the pool refreshes the instant
    // another cleaner takes a job. PMS-driven changes did not, so a booking
    // extended in Avantio silently moved a turnover to another day while every
    // running app kept rendering the copy it fetched hours earlier. A cleaner
    // saw a cleaning on the wrong day until she happened to reload.
    //
    // ONE emit per run, not per booking: a sync can touch hundreds of rows and
    // the clients respond by refetching, so per-booking emission would be a
    // self-inflicted thundering herd.
    const changed =
      bookingResult.created + bookingResult.updated + bookingResult.cancelled;
    if (changed > 0) {
      this.gateway?.emitToTenant(tenantId, 'event:updated', {
        source: 'pms-sync',
        created: bookingResult.created,
        updated: bookingResult.updated,
        cancelled: bookingResult.cancelled,
        at: new Date().toISOString(),
      });
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
  async reconcilePreviousGuestCheckOut(
    tenantId: string,
    sinceDays: number | null = 60,
  ): Promise<number> {
    // The 30-minute sync only needs the recent tail; scanning every cleaning
    // the tenant has ever had gets slower forever. A backfill that touches old
    // bookings passes null to force the full pass.
    const window =
      sinceDays === null
        ? Prisma.empty
        // ::int is required. Prisma binds a JS number as int8, and Postgres has
        // no make_interval(days => bigint) overload — it fails with 42883.
        : Prisma.sql`AND c."checkInTime" >= now() - make_interval(days => ${sinceDays}::int)`;

    const result = await this.prisma.$executeRaw(Prisma.sql`
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
        ${window}
      )
      UPDATE "cleanings" c
      SET "previousGuestCheckOutTime" = computed.prev
      FROM computed
      WHERE c.id = computed.id
        AND c."previousGuestCheckOutTime" IS DISTINCT FROM computed.prev
    `);
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
      // Lets the Planning view flag times we assumed (FALLBACK) vs. confirmed ones.
      checkInSource: (b as any).checkInSource,
      checkOutSource: (b as any).checkOutSource,
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
    actorId?: string,
    actorEmail?: string,
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

    // The audit row should name a person, not a service account.
    const actor = actorId
      ? await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { email: true },
        })
      : null;
    const resolvedActorEmail = actorEmail ?? actor?.email ?? 'planning@cleanops';

    const oldCheckInTime = b.checkInTime; // capture for turnover sync

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          // A human decided this. Mark it, so no later sync replaces it with
          // the house default when Avantio goes on returning midnight.
          ...(data.checkInTime && {
            checkInTime: new Date(data.checkInTime),
            checkInSource: 'MANAGER' as any,
          }),
          ...(data.checkOutTime && {
            checkOutTime: new Date(data.checkOutTime),
            checkOutSource: 'MANAGER' as any,
          }),
          pmsLastSyncedAt: now,
        },
      });

      // Until now the only audited change on a booking was its cancellation.
      // "Why does this cleaning end at three" deserves an answer too.
      await tx.auditEvent.create({
        data: {
          tenantId,
          category: 'PMS_SYNC' as any,
          action: 'booking.times_updated_via_planning',
          actorId: actorId ?? null,
          actorEmail: resolvedActorEmail,
          targetType: 'Booking',
          targetId: b.id,
          metadata: {
            pmsBookingId,
            bookingRef: b.bookingRef,
            accommodationName: b.accommodationName,
            previousCheckInTime: b.checkInTime?.toISOString() ?? null,
            previousCheckOutTime: b.checkOutTime?.toISOString() ?? null,
            newCheckInTime: data.checkInTime ?? null,
            newCheckOutTime: data.checkOutTime ?? null,
          } as any,
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

    // Turnover dual-write: only relevant if checkInTime actually changed
    if (data.checkInTime) {
      await this.safelyRunTurnoverSync('onBookingModified.fromPlanning', async (tx) => {
        await this.turnoverSync.onBookingModified(b.id, oldCheckInTime, tx);
      });
    }

    // A manager editing times in Planning is the other way these change, and
    // for the cleaner it is the same event as a PMS edit.
    if (data.checkInTime && oldCheckInTime.getTime() !== new Date(data.checkInTime).getTime()) {
      await this.notifyTurnoverAssignees(tenantId, b.id, 'to', {
        kind: 'CHECKIN_CHANGED',
        fromValue: oldCheckInTime.toISOString(),
        toValue: new Date(data.checkInTime).toISOString(),
        title: 'Arrival time changed',
        body: (name) => `${name} — the guest now arrives at a different time.`,
      });
    }
    if (data.checkOutTime && b.checkOutTime &&
        b.checkOutTime.getTime() !== new Date(data.checkOutTime).getTime()) {
      const later = new Date(data.checkOutTime).getTime() > b.checkOutTime.getTime();
      await this.notifyTurnoverAssignees(tenantId, b.id, 'from', {
        kind: later ? 'STAY_EXTENDED' : 'STAY_SHORTENED',
        fromValue: b.checkOutTime.toISOString(),
        toValue: new Date(data.checkOutTime).toISOString(),
        title: later ? 'Stay extended' : 'Stay shortened',
        body: (name) =>
          later
            ? `${name} — the guest stays longer, so the cleaning moves back.`
            : `${name} — the guest leaves earlier, so the cleaning moves up.`,
      });
    }

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
          // Keep the per-folder _NAME_*.txt marker in sync with the current
          // Avantio name. Handles renames by deleting stale markers.
          this.gcs
            .upsertPropertyNameMarker(accom.pmsId, accom.name)
            .catch((err) =>
              this.logger.warn(
                `GCS name marker failed for ${accom.pmsId}: ${err?.message}`,
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
          // Drop a _NAME_*.txt marker inside the folder so the unit name is
          // visible at a glance when browsing in the GCP console.
          this.gcs
            .upsertPropertyNameMarker(accom.pmsId, accom.name)
            .catch((err) =>
              this.logger.warn(
                `GCS name marker failed for ${accom.pmsId}: ${err?.message}`,
              ),
            );
        }
      } catch (err) {
        this.logger.warn(`Failed to sync accommodation ${accom.pmsId}: ${err.message}`);
      }
    }

    // Refresh the bucket-root _INDEX.txt listing all current properties.
    // Pinned at the top when browsing the bucket. Non-blocking.
    this.gcs
      .writePropertyIndex(
        accommodations.map((a) => ({
          pmsPropertyId: a.pmsId,
          name: a.name,
        })),
      )
      .catch((err) =>
        this.logger.warn(`GCS writePropertyIndex failed: ${err?.message}`),
      );

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
        // A unit change in the PMS used to be invisible here, which left the
        // booking (and its whole turnover chain) attached to the old property.
        existing.propertyId !== property.id ||
        existing.isOwnerStay !== incomingOwnerFlag;

      if (hasChanges) {
        const now = new Date();

        // A time a human set outranks anything the PMS sends back, but only
        // when what comes back is a guess. Avantio keeps returning "0:00" for
        // Airbnb bookings even after a manager has set a real arrival time, so
        // without this the next sync would quietly undo their work.
        const keepManagerCheckIn =
          existing.checkInSource === 'MANAGER' && !!booking.checkInAssumed;
        const keepManagerCheckOut =
          existing.checkOutSource === 'MANAGER' && !!booking.checkOutAssumed;

        const checkIn = keepManagerCheckIn
          ? existing.checkInTime
          : new Date(booking.checkInTime);
        const checkOut = keepManagerCheckOut
          ? existing.checkOutTime
          : booking.checkOutTime ? new Date(booking.checkOutTime) : null;

        const checkInSource = keepManagerCheckIn
          ? 'MANAGER'
          : booking.checkInAssumed ? 'FALLBACK' : 'PMS';
        const checkOutSource = keepManagerCheckOut
          ? 'MANAGER'
          : booking.checkOutAssumed ? 'FALLBACK' : 'PMS';

        const oldCheckInTime = existing.checkInTime;   // capture for turnover sync
        const oldPropertyId = existing.propertyId;    // ditto — unit moves

        await this.prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: existing.id },
            data: {
              propertyId: property.id,
              checkInTime: checkIn,
              checkInSource: checkInSource as any,
              checkOutTime: checkOut,
              checkOutSource: checkOutSource as any,
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
                propertyId: property.id,
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

        // What actually changed, from the cleaner's point of view. Sent before
        // the chain is re-threaded, while the booking references still hold.
        const guestsBefore = `${existing.numAdults}+${existing.numChildren}`;
        const guestsAfter = `${booking.numAdults}+${booking.numChildren}`;
        if (guestsBefore !== guestsAfter) {
          await this.notifyTurnoverAssignees(tenantId, existing.id, 'to', {
            kind: 'GUESTS_CHANGED',
            fromValue: guestsBefore,
            toValue: guestsAfter,
            title: 'Guest count changed',
            body: (name) =>
              `${name} — the party changed to ${booking.numAdults} adults` +
              `${booking.numChildren ? ` and ${booking.numChildren} children` : ''}. ` +
              `Check bedding and towels.`,
          });
        }

        if (existing.checkInTime.getTime() !== checkIn.getTime()) {
          await this.notifyTurnoverAssignees(tenantId, existing.id, 'to', {
            kind: 'CHECKIN_CHANGED',
            fromValue: existing.checkInTime.toISOString(),
            toValue: checkIn.toISOString(),
            title: 'Arrival time changed',
            body: (name) => `${name} — the guest now arrives at a different time.`,
          });
        }

        const oldCheckOut = existing.checkOutTime ?? null;
        if (checkOut && oldCheckOut && oldCheckOut.getTime() !== checkOut.getTime()) {
          const later = checkOut.getTime() > oldCheckOut.getTime();
          await this.notifyTurnoverAssignees(tenantId, existing.id, 'from', {
            kind: later ? 'STAY_EXTENDED' : 'STAY_SHORTENED',
            fromValue: oldCheckOut.toISOString(),
            toValue: checkOut.toISOString(),
            title: later ? 'Stay extended' : 'Stay shortened',
            body: (name) =>
              later
                ? `${name} — the guest stays longer, so the cleaning moves back.`
                : `${name} — the guest leaves earlier, so the cleaning moves up.`,
          });
        }

        // Turnover dual-write: re-thread chain if position changed, or just
        // update anchors if booking is still in the same slot
        await this.safelyRunTurnoverSync('onBookingModified', async (tx) => {
          await this.turnoverSync.onBookingModified(
            existing.id, oldCheckInTime, tx, oldPropertyId,
          );
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
          checkInSource: (booking.checkInAssumed ? 'FALLBACK' : 'PMS') as any,
          checkOutTime: checkOut,
          checkOutSource: (booking.checkOutAssumed ? 'FALLBACK' : 'PMS') as any,
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

    // Turnover dual-write: slot the new booking into the chain at its property
    await this.safelyRunTurnoverSync('onBookingInserted', async (tx) => {
      await this.turnoverSync.onBookingInserted(created.booking.id, tx);
    });

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

    // Who is actually holding this work RIGHT NOW, under the turnover model.
    // Read before the chain is re-stitched: onBookingCancelled supersedes rows
    // and nulls the booking references, after which this lookup finds nothing.
    //
    // The block below this one notifies `cleaning.assignments` instead — the
    // legacy model, which is empty for anything claimed through the pool. That
    // is why cancellations have been silent in practice.
    const affectedTurnovers = await this.prisma.turnover.findMany({
      where: {
        tenantId,
        supersededById: null,
        OR: [{ fromBookingId: existing.id }, { toBookingId: existing.id }],
      },
      select: {
        id: true,
        property: { select: { name: true } },
        toBooking: { select: { checkInTime: true } },
        assignments: {
          where: { status: { in: ['ASSIGNED', 'STARTED'] } },
          select: { userId: true },
        },
      },
    });

    // Turnover dual-write: stitch the chain back together
    await this.safelyRunTurnoverSync('onBookingCancelled', async (tx) => {
      await this.turnoverSync.onBookingCancelled(existing.id, tx);
    });

    for (const t of affectedTurnovers) {
      const propertyName = t.property?.name ?? existing.accommodationName ?? '';
      for (const a of t.assignments) {
        await this.createNotification(
          tenantId, a.userId, 'CANCELLATION',
          'Booking cancelled',
          `${propertyName} — the guest booking was cancelled. The cleaning is ` +
          `still yours and still needs doing; there is no arrival deadline now.`,
          t.id,
          {
            kind: 'BOOKING_CANCELLED',
            turnoverId: t.id,
            propertyName,
            bookingRef: existing.bookingRef,
            fromValue: t.toBooking?.checkInTime ?? null,
            toValue: null,
          },
        );
      }
    }

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

  // ═══════════════════════════════════════════════════════════════
  // ID-DRIVEN BACKFILL  (scripts/backfill-bookings.ts)
  // ═══════════════════════════════════════════════════════════════
  //
  // Everything below is for filling gaps: bookings Avantio has that we missed,
  // usually because a sync run failed or the process restarted mid-window.
  //
  // Two hard rules separate this from syncTenant():
  //   1. It NEVER writes tenant.pmsLastSyncAt. The cron uses that column as its
  //      `since`, so a backfill that advanced it would make the cron skip a
  //      window it never actually covered.
  //   2. It reuses processBooking() rather than reimplementing the upsert, so
  //      the timezone handling, status mapping and turnover dual-write stay in
  //      exactly one place.

  /** Resolve a tenant's PMS credentials and adapter, or throw. */
  async getTenantSyncContext(tenantId: string): Promise<{
    tenant: { id: string; name: string };
    config: PmsTenantConfig;
    adapter: AvantioAdapter;
  }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    if (!tenant.pmsApiBaseUrl || !tenant.pmsApiKey) {
      throw new Error(
        `Tenant ${tenant.name} has no PMS credentials (pmsApiBaseUrl / pmsApiKey). ` +
        `Per-tenant config is deliberate — do not fall back to global env vars.`,
      );
    }
    return {
      tenant: { id: tenant.id, name: tenant.name },
      config: { apiBaseUrl: tenant.pmsApiBaseUrl, apiKey: tenant.pmsApiKey },
      adapter: this.getAdapter(tenant.pmsProvider || 'avantio'),
    };
  }

  /**
   * Of `candidateIds` (Avantio booking IDs), return the ones with no Booking
   * row for this tenant. This is the gap the backfill is meant to close.
   */
  async findMissingPmsBookingIds(
    tenantId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    const known = new Set<string>();
    const CHUNK = 1000;
    for (let i = 0; i < candidateIds.length; i += CHUNK) {
      const chunk = candidateIds.slice(i, i + CHUNK);
      const rows = await this.prisma.booking.findMany({
        where: { tenantId, pmsBookingId: { in: chunk } },
        select: { pmsBookingId: true },
      });
      for (const r of rows) if (r.pmsBookingId) known.add(r.pmsBookingId);
    }
    return candidateIds.filter((id) => !known.has(id));
  }

  /**
   * Fetch full booking detail for each ID. Network-bound, so it runs
   * `concurrency` at a time; the DB work that follows stays sequential because
   * two bookings at the same property would otherwise race on the same
   * turnover chain.
   */
  private async fetchDetails(
    ids: string[],
    adapter: AvantioAdapter,
    config: PmsTenantConfig,
    concurrency: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Array<{ pmsBookingId: string; booking?: PmsBooking; error?: string }>> {
    const out: Array<{ pmsBookingId: string; booking?: PmsBooking; error?: string }> = [];

    for (let i = 0; i < ids.length; i += concurrency) {
      const batch = ids.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map((id) => adapter.getBooking(id, config)),
      );
      settled.forEach((r, idx) => {
        const pmsBookingId = batch[idx];
        if (r.status === 'fulfilled') out.push({ pmsBookingId, booking: r.value });
        else out.push({ pmsBookingId, error: (r.reason as Error)?.message ?? 'fetch failed' });
      });
      onProgress?.(Math.min(i + concurrency, ids.length), ids.length);
    }

    return out;
  }

  /**
   * Read-only dry run: what would `syncBookingsByPmsIds` do?
   *
   * Mirrors processBooking's decisions without writing. It deliberately does
   * NOT call resolveProperty(), because that method creates properties as a
   * side effect.
   */
  async previewBookingsByPmsIds(
    tenantId: string,
    pmsBookingIds: string[],
    opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<BookingSyncOutcome[]> {
    const { adapter, config } = await this.getTenantSyncContext(tenantId);
    const fetched = await this.fetchDetails(
      pmsBookingIds, adapter, config, opts.concurrency ?? 5, opts.onProgress,
    );

    const outcomes: BookingSyncOutcome[] = [];

    for (const f of fetched) {
      if (!f.booking) {
        outcomes.push({ pmsBookingId: f.pmsBookingId, result: 'error', detail: f.error });
        continue;
      }
      const b = f.booking;

      const existing = await this.prisma.booking.findFirst({
        where: { tenantId, pmsBookingId: b.pmsBookingId },
      });

      if (b.status === 'cancelled') {
        if (!existing) {
          outcomes.push({
            pmsBookingId: b.pmsBookingId,
            result: 'skipped',
            detail: 'cancelled in Avantio and absent locally — nothing to record',
          });
        } else if (existing.status === BookingStatus.CANCELLED) {
          outcomes.push({
            pmsBookingId: b.pmsBookingId, result: 'skipped',
            detail: 'already CANCELLED locally',
          });
        } else {
          outcomes.push({
            pmsBookingId: b.pmsBookingId, result: 'cancelled',
            detail: `would mark ${existing.bookingRef} CANCELLED (cleaning kept)`,
          });
        }
        continue;
      }

      const property = b.pmsPropertyId
        ? await this.prisma.property.findFirst({
            where: { tenantId, pmsPropertyId: b.pmsPropertyId },
          })
        : null;
      const propertyNote = property
        ? ''
        : ` (accommodation ${b.pmsPropertyId ?? '?'} not local — would be fetched from Avantio or stubbed)`;

      if (!existing) {
        outcomes.push({
          pmsBookingId: b.pmsBookingId,
          result: 'created',
          detail:
            `would create booking ${b.bookingRef} + cleaning at ` +
            `${property?.name ?? b.pmsPropertyId} , check-in ${b.checkInTime}` +
            propertyNote,
        });
        continue;
      }

      const diffs: string[] = [];
      if (existing.checkInTime.toISOString() !== new Date(b.checkInTime).toISOString()) {
        diffs.push(`checkIn ${existing.checkInTime.toISOString()} -> ${new Date(b.checkInTime).toISOString()}`);
      }
      if (b.checkOutTime && existing.checkOutTime?.toISOString() !== new Date(b.checkOutTime).toISOString()) {
        diffs.push(`checkOut ${existing.checkOutTime?.toISOString() ?? 'null'} -> ${new Date(b.checkOutTime).toISOString()}`);
      }
      if (existing.numAdults !== b.numAdults) diffs.push(`adults ${existing.numAdults} -> ${b.numAdults}`);
      if (existing.numChildren !== b.numChildren) diffs.push(`children ${existing.numChildren} -> ${b.numChildren}`);
      if (property && existing.accommodationName !== property.name) {
        diffs.push(`accommodation "${existing.accommodationName}" -> "${property.name}"`);
      }
      if (property && existing.propertyId !== property.id) diffs.push('property moved');
      if (existing.isOwnerStay !== (b.isOwnerStay ?? false)) {
        diffs.push(`isOwnerStay ${existing.isOwnerStay} -> ${b.isOwnerStay ?? false}`);
      }

      outcomes.push(
        diffs.length
          ? { pmsBookingId: b.pmsBookingId, result: 'updated', detail: diffs.join('; ') + propertyNote }
          : { pmsBookingId: b.pmsBookingId, result: 'skipped', detail: 'already in sync' },
      );
    }

    return outcomes;
  }

  /**
   * Sync a specific set of Avantio booking IDs into this tenant.
   * Wrap the call in runWithoutNotifications() for a historical backfill.
   */
  async syncBookingsByPmsIds(
    tenantId: string,
    pmsBookingIds: string[],
    opts: {
      concurrency?: number;
      onFetchProgress?: (done: number, total: number) => void;
      onProcessed?: (outcome: BookingSyncOutcome, index: number, total: number) => void;
    } = {},
  ): Promise<BookingSyncOutcome[]> {
    const { adapter, config } = await this.getTenantSyncContext(tenantId);
    const fetched = await this.fetchDetails(
      pmsBookingIds, adapter, config, opts.concurrency ?? 5, opts.onFetchProgress,
    );

    const outcomes: BookingSyncOutcome[] = [];

    for (let i = 0; i < fetched.length; i++) {
      const f = fetched[i];
      let outcome: BookingSyncOutcome;

      if (!f.booking) {
        outcome = { pmsBookingId: f.pmsBookingId, result: 'error', detail: f.error };
      } else {
        try {
          const result = await this.processBooking(tenantId, f.booking, adapter, config);
          outcome = { pmsBookingId: f.pmsBookingId, result };
        } catch (err) {
          outcome = {
            pmsBookingId: f.pmsBookingId,
            result: 'error',
            detail: (err as Error).message,
          };
        }
      }

      outcomes.push(outcome);
      opts.onProcessed?.(outcome, i + 1, fetched.length);
    }

    return outcomes;
  }

  // ─── Helpers ───

  /**
   * Tell whoever is holding the affected cleaning what changed, in terms of the
   * work rather than the record: "2 adults → 4 adults", not "a booking was
   * modified".
   *
   * `side` picks which end of the chain cares. A check-out moving changes when
   * the cleaner can START (the turnover whose `from` booking this is); a
   * check-in or a guest count moving changes what she is preparing FOR (the
   * turnover whose `to` booking this is).
   *
   * Must run BEFORE the turnover chain is re-threaded — afterwards the booking
   * references have moved and this finds nothing.
   */
  private async notifyTurnoverAssignees(
    tenantId: string,
    bookingId: string,
    side: 'to' | 'from',
    change: {
      kind: string;
      fromValue: string | number | null;
      toValue: string | number | null;
      title: string;
      body: (propertyName: string) => string;
    },
  ) {
    const turnovers = await this.prisma.turnover.findMany({
      where: {
        tenantId,
        supersededById: null,
        completedAt: null,
        ...(side === 'to' ? { toBookingId: bookingId } : { fromBookingId: bookingId }),
      },
      select: {
        id: true,
        property: { select: { name: true } },
        assignments: {
          where: { status: { in: ['ASSIGNED', 'STARTED'] } },
          select: { userId: true },
        },
      },
    });

    for (const t of turnovers) {
      const propertyName = t.property?.name ?? '';
      for (const a of t.assignments) {
        await this.createNotification(
          tenantId, a.userId, 'BOOKING_MODIFIED',
          change.title, change.body(propertyName), t.id,
          {
            kind: change.kind,
            turnoverId: t.id,
            propertyName,
            fromValue: change.fromValue,
            toValue: change.toValue,
          },
        );
      }
    }
  }

  private async createNotification(
    tenantId: string, userId: string, type: string,
    title: string, body: string, eventId: string,
    payload: Record<string, any> = {},
  ) {
    if (this.notificationsSuppressed) return;
    await this.prisma.notification.create({
      data: {
        tenantId, userId,
        type: type as any,
        channel: 'IN_APP',
        title, body,
        // The extra payload is what lets the app render "2 adults → 4 adults"
        // instead of "a booking was modified".
        payload: { eventId, ...payload },
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