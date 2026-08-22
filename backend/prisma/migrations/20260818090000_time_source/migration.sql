-- Where a booking's times came from.
--
-- Avantio sends "0:00 " for bookings whose channel never collected an arrival
-- time — Airbnb, mostly. That string is truthy, so the adapter's `|| '15:00'`
-- default never fired and midnight was stored as though the guest had asked
-- for it. The turnover then inherited a deadline at the start of the day and
-- every such cleaning looked overdue from its first second.
--
-- Substituting 15:00 fixes the deadline but loses something: a time the guest
-- actually gave and a time we invented become indistinguishable. This column
-- keeps them apart, and gives the manager a list of what still needs
-- confirming.
--
-- Existing rows default to PMS. That is deliberately optimistic — the backfill
-- script re-classifies the midnight ones, and it can tell them apart because
-- pmsRawData still holds what Avantio said at the last sync.

CREATE TYPE "TimeSource" AS ENUM ('PMS', 'FALLBACK', 'MANAGER');

ALTER TABLE "bookings" ADD COLUMN "checkInSource"  "TimeSource" NOT NULL DEFAULT 'PMS';
ALTER TABLE "bookings" ADD COLUMN "checkOutSource" "TimeSource" NOT NULL DEFAULT 'PMS';
