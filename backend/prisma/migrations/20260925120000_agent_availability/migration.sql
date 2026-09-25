-- Agent availability: blocks of time an agent declares they can work.
-- Prague wall-clock (day + minutes), not instants — see schema.prisma.

CREATE TABLE "agent_availability" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "day"         TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute"   INTEGER NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_availability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_availability_range_check"
        CHECK ("startMinute" >= 0 AND "startMinute" < 1440
           AND "endMinute" > "startMinute" AND "endMinute" <= 1800)
);

CREATE INDEX "agent_availability_tenantId_day_idx" ON "agent_availability"("tenantId", "day");
CREATE INDEX "agent_availability_userId_day_idx" ON "agent_availability"("userId", "day");

ALTER TABLE "agent_availability"
    ADD CONSTRAINT "agent_availability_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_availability"
    ADD CONSTRAINT "agent_availability_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
