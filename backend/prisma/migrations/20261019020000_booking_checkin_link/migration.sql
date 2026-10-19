-- Guest online check-in link pulled from Avantio externalPartners.
ALTER TABLE "bookings"
  ADD COLUMN "checkInLinkUrl" TEXT,
  ADD COLUMN "checkInLinkProvider" TEXT,
  ADD COLUMN "checkInLinkSyncedAt" TIMESTAMP(3);
