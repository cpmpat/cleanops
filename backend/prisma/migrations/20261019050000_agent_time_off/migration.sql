-- Agent time off, and its audit category.
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'AVAILABILITY_LIFECYCLE';

CREATE TYPE "TimeOffReason" AS ENUM ('VACATION', 'SICK', 'OTHER');

CREATE TABLE "agent_time_off" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "reason" "TimeOffReason" NOT NULL,
  "note" TEXT,
  "setById" TEXT NOT NULL,
  "via" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_time_off_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_time_off_userId_day_key" ON "agent_time_off"("userId", "day");
CREATE INDEX "agent_time_off_tenantId_day_idx" ON "agent_time_off"("tenantId", "day");

ALTER TABLE "agent_time_off"
  ADD CONSTRAINT "agent_time_off_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
