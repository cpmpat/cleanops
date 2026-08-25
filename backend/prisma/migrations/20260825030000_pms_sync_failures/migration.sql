-- Remembers bookings the sync could not fetch or process.
--
-- Before this table a rejected GET /bookings/{id} was logged and dropped while
-- tenant."pmsLastSyncAt" still advanced past it, so the booking was never asked
-- for again. 19 bookings were found missing that way, three of them cleanings
-- whose arrival had already passed.

CREATE TABLE "pms_sync_failures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pmsBookingId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pms_sync_failures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pms_sync_failures_tenantId_pmsBookingId_key"
    ON "pms_sync_failures"("tenantId", "pmsBookingId");

CREATE INDEX "pms_sync_failures_tenantId_idx" ON "pms_sync_failures"("tenantId");

ALTER TABLE "pms_sync_failures" ADD CONSTRAINT "pms_sync_failures_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
