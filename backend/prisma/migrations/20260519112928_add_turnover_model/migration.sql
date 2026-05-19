-- CreateEnum
CREATE TYPE "TurnoverStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FLAGGED', 'CANCELLED', 'SKIPPED');

-- CreateTable
CREATE TABLE "turnovers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fromBookingId" TEXT,
    "toBookingId" TEXT,
    "availableFrom" TIMESTAMP(3),
    "dueBy" TIMESTAMP(3),
    "status" "TurnoverStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAllGood" BOOLEAN,
    "maxCleaners" INTEGER NOT NULL DEFAULT 1,
    "managerNote" TEXT,
    "cleanerNote" TEXT,
    "supplyNote" TEXT,
    "isOwnerStay" BOOLEAN NOT NULL DEFAULT false,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnover_assignments" (
    "id" TEXT NOT NULL,
    "turnoverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "rejectedReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turnover_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "turnovers_supersededById_key" ON "turnovers"("supersededById");

-- CreateIndex
CREATE INDEX "turnovers_tenantId_propertyId_availableFrom_idx" ON "turnovers"("tenantId", "propertyId", "availableFrom");

-- CreateIndex
CREATE INDEX "turnovers_tenantId_status_dueBy_idx" ON "turnovers"("tenantId", "status", "dueBy");

-- CreateIndex
CREATE INDEX "turnovers_tenantId_status_idx" ON "turnovers"("tenantId", "status");

-- CreateIndex
CREATE INDEX "turnovers_toBookingId_idx" ON "turnovers"("toBookingId");

-- CreateIndex
CREATE INDEX "turnovers_fromBookingId_idx" ON "turnovers"("fromBookingId");

-- CreateIndex
CREATE INDEX "turnover_assignments_turnoverId_idx" ON "turnover_assignments"("turnoverId");

-- CreateIndex
CREATE INDEX "turnover_assignments_userId_idx" ON "turnover_assignments"("userId");

-- CreateIndex
CREATE INDEX "turnover_assignments_userId_status_idx" ON "turnover_assignments"("userId", "status");

-- AddForeignKey
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "turnovers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_fromBookingId_fkey" FOREIGN KEY ("fromBookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnovers" ADD CONSTRAINT "turnovers_toBookingId_fkey" FOREIGN KEY ("toBookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_assignments" ADD CONSTRAINT "turnover_assignments_turnoverId_fkey" FOREIGN KEY ("turnoverId") REFERENCES "turnovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_assignments" ADD CONSTRAINT "turnover_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_assignments" ADD CONSTRAINT "turnover_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
