-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'REPORTED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RepairAssignmentStatus" AS ENUM ('ASSIGNED', 'STARTED', 'COMPLETED', 'REJECTED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "RepairAuthorRole" AS ENUM ('MANAGER', 'REPAIRMAN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RepairReportUrgency" AS ENUM ('LOW', 'AVERAGE', 'HIGH');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'REPAIRMAN';

-- CreateTable
CREATE TABLE "repairs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "incidentId" TEXT,
    "status" "RepairStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_assignments" (
    "id" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "RepairAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "rejectedReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_materials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_material_usages" (
    "id" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_material_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_photos" (
    "id" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_comments" (
    "id" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" "RepairAuthorRole" NOT NULL DEFAULT 'MANAGER',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_reports" (
    "id" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "urgency" "RepairReportUrgency" NOT NULL,
    "description" TEXT NOT NULL,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repairs_incidentId_key" ON "repairs"("incidentId");

-- CreateIndex
CREATE INDEX "repairs_tenantId_status_dueDate_idx" ON "repairs"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "repairs_tenantId_dueDate_idx" ON "repairs"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "repairs_propertyId_idx" ON "repairs"("propertyId");

-- CreateIndex
CREATE INDEX "repair_assignments_repairId_idx" ON "repair_assignments"("repairId");

-- CreateIndex
CREATE INDEX "repair_assignments_userId_idx" ON "repair_assignments"("userId");

-- CreateIndex
CREATE INDEX "repair_assignments_userId_status_idx" ON "repair_assignments"("userId", "status");

-- CreateIndex
CREATE INDEX "repair_materials_tenantId_isActive_idx" ON "repair_materials"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "repair_materials_tenantId_name_key" ON "repair_materials"("tenantId", "name");

-- CreateIndex
CREATE INDEX "repair_material_usages_repairId_idx" ON "repair_material_usages"("repairId");

-- CreateIndex
CREATE INDEX "repair_photos_repairId_idx" ON "repair_photos"("repairId");

-- CreateIndex
CREATE INDEX "repair_comments_repairId_createdAt_idx" ON "repair_comments"("repairId", "createdAt");

-- CreateIndex
CREATE INDEX "repair_reports_repairId_createdAt_idx" ON "repair_reports"("repairId", "createdAt");

-- AddForeignKey
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repairs" ADD CONSTRAINT "repairs_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_assignments" ADD CONSTRAINT "repair_assignments_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_assignments" ADD CONSTRAINT "repair_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_assignments" ADD CONSTRAINT "repair_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_materials" ADD CONSTRAINT "repair_materials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_material_usages" ADD CONSTRAINT "repair_material_usages_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_material_usages" ADD CONSTRAINT "repair_material_usages_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "repair_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_photos" ADD CONSTRAINT "repair_photos_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_photos" ADD CONSTRAINT "repair_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_comments" ADD CONSTRAINT "repair_comments_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_comments" ADD CONSTRAINT "repair_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_reports" ADD CONSTRAINT "repair_reports_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_reports" ADD CONSTRAINT "repair_reports_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
