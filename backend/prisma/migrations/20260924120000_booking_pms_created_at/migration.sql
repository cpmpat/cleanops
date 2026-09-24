-- When the guest booked, per the PMS. Backfilled from the stored Avantio
-- payload so the last-minute mark is right for bookings synced before this
-- column existed (the row's own createdAt is when we first saw the booking,
-- which for a backfilled one is days or weeks after the guest booked).
ALTER TABLE "bookings" ADD COLUMN "pmsCreatedAt" TIMESTAMP(3);

UPDATE "bookings"
SET "pmsCreatedAt" = ("pmsRawData"->>'createdAt')::timestamptz
WHERE "pmsRawData"->>'createdAt' IS NOT NULL
  AND "pmsRawData"->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}';
