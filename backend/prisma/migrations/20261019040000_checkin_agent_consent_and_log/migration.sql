-- Check-in agent: change log, who must see each change, and consent for overrides.
CREATE TYPE "CheckInChangeKind" AS ENUM ('ASSIGNED', 'REASSIGNED', 'UNASSIGNED');
CREATE TYPE "CheckInConsent" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'PHONE');
CREATE TYPE "CheckInResponse" AS ENUM ('ACK', 'ACCEPT', 'DECLINE', 'PHONE');

ALTER TABLE "bookings"
  ADD COLUMN "checkInAgentConsent" "CheckInConsent" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "checkInDeclinedAgentName" TEXT,
  ADD COLUMN "checkInDeclinedAt" TIMESTAMP(3);

CREATE TABLE "checkin_assignment_changes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "kind" "CheckInChangeKind" NOT NULL,
  "fromAgentId" TEXT,
  "toAgentId" TEXT,
  "changedById" TEXT NOT NULL,
  "override" BOOLEAN NOT NULL DEFAULT false,
  "snapshot" JSONB NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "checkin_assignment_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "checkin_change_recipients" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ackedAt" TIMESTAMP(3),
  "response" "CheckInResponse",
  "via" TEXT,
  "recordedById" TEXT,
  CONSTRAINT "checkin_change_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "checkin_assignment_changes_tenantId_bookingId_changedAt_idx"
  ON "checkin_assignment_changes"("tenantId", "bookingId", "changedAt");
CREATE UNIQUE INDEX "checkin_change_recipients_changeId_userId_key"
  ON "checkin_change_recipients"("changeId", "userId");
CREATE INDEX "checkin_change_recipients_userId_ackedAt_idx"
  ON "checkin_change_recipients"("userId", "ackedAt");

ALTER TABLE "checkin_assignment_changes"
  ADD CONSTRAINT "checkin_assignment_changes_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkin_change_recipients"
  ADD CONSTRAINT "checkin_change_recipients_changeId_fkey"
  FOREIGN KEY ("changeId") REFERENCES "checkin_assignment_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
