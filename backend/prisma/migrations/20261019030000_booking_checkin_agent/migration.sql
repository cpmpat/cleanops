-- The check-in agent on a booking (one per booking; no separate assignment table).
ALTER TABLE "bookings"
  ADD COLUMN "checkInAgentId" TEXT,
  ADD COLUMN "checkInAgentAssignedById" TEXT,
  ADD COLUMN "checkInAgentAssignedAt" TIMESTAMP(3),
  ADD COLUMN "checkInAgentOverride" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checkInAgentId_fkey"
  FOREIGN KEY ("checkInAgentId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bookings_tenantId_checkInAgentId_checkInTime_idx"
  ON "bookings"("tenantId", "checkInAgentId", "checkInTime");
