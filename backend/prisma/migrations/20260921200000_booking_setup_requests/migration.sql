-- Setup requests recorded by the front desk: a crib, separate beds.
-- Local to CleanOps; never pushed to the PMS, never touched by the sync.
ALTER TABLE "bookings"
  ADD COLUMN "needsCrib"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "separateBeds" BOOLEAN NOT NULL DEFAULT false;
