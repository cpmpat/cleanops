/*
  Warnings:

  - The values [USER_LIFECYCLE,SYNC] on the enum `AuditCategory` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `cleaningEventId` on the `cleaning_assignments` table. All the data in the column will be lost.
  - You are about to drop the column `cleaningEventId` on the `cleaning_photos` table. All the data in the column will be lost.
  - You are about to drop the column `cleaningEventId` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the `cleaning_event_tags` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cleaning_events` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `cleaningId` to the `cleaning_assignments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cleaningId` to the `cleaning_photos` table without a default value. This is not possible if the table is not empty.
  - Made the column `payload` on table `notifications` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "CleaningStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StreamEventCategory" AS ENUM ('MANUAL', 'NOTE', 'REPAIR', 'INSPECTION');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditCategory_new" AS ENUM ('CLEANING_LIFECYCLE', 'ASSIGNMENT_LIFECYCLE', 'AUTH', 'PMS_SYNC', 'INCIDENT_LIFECYCLE', 'SYSTEM');
ALTER TABLE "audit_events" ALTER COLUMN "category" TYPE "AuditCategory_new" USING ("category"::text::"AuditCategory_new");
ALTER TYPE "AuditCategory" RENAME TO "AuditCategory_old";
ALTER TYPE "AuditCategory_new" RENAME TO "AuditCategory";
DROP TYPE "AuditCategory_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "cleaning_assignments" DROP CONSTRAINT "cleaning_assignments_cleaningEventId_fkey";

-- DropForeignKey
ALTER TABLE "cleaning_event_tags" DROP CONSTRAINT "cleaning_event_tags_cleaningEventId_fkey";

-- DropForeignKey
ALTER TABLE "cleaning_event_tags" DROP CONSTRAINT "cleaning_event_tags_tagId_fkey";

-- DropForeignKey
ALTER TABLE "cleaning_events" DROP CONSTRAINT "cleaning_events_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "cleaning_events" DROP CONSTRAINT "cleaning_events_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "cleaning_photos" DROP CONSTRAINT "cleaning_photos_cleaningEventId_fkey";

-- DropForeignKey
ALTER TABLE "incidents" DROP CONSTRAINT "incidents_cleaningEventId_fkey";

-- DropIndex
DROP INDEX "audit_events_targetType_targetId_idx";

-- DropIndex
DROP INDEX "cleaning_assignments_cleaningEventId_idx";

-- DropIndex
DROP INDEX "cleaning_photos_cleaningEventId_idx";

-- DropIndex
DROP INDEX "incidents_cleaningEventId_idx";

-- DropIndex
DROP INDEX "notifications_tenantId_idx";

-- AlterTable
ALTER TABLE "audit_events" ALTER COLUMN "targetType" DROP NOT NULL,
ALTER COLUMN "metadata" DROP NOT NULL,
ALTER COLUMN "metadata" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cleaning_assignments" DROP COLUMN "cleaningEventId",
ADD COLUMN     "cleaningId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cleaning_photos" DROP COLUMN "cleaningEventId",
ADD COLUMN     "cleaningId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "incidents" DROP COLUMN "cleaningEventId",
ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "cleaningId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "payload" SET NOT NULL,
ALTER COLUMN "payload" SET DEFAULT '{}',
ALTER COLUMN "sentAt" DROP NOT NULL,
ALTER COLUMN "sentAt" DROP DEFAULT;

-- DropTable
DROP TABLE "cleaning_event_tags";

-- DropTable
DROP TABLE "cleaning_events";

-- DropEnum
DROP TYPE "CleaningEventStatus";

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bookingRef" TEXT NOT NULL,
    "pmsBookingId" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelledAt" TIMESTAMP(3),
    "checkInTime" TIMESTAMP(3) NOT NULL,
    "checkOutTime" TIMESTAMP(3),
    "accommodationName" TEXT NOT NULL,
    "accommodationType" TEXT,
    "numAdults" INTEGER NOT NULL DEFAULT 1,
    "numChildren" INTEGER NOT NULL DEFAULT 0,
    "channel" "BookingChannel" NOT NULL DEFAULT 'OTHER',
    "pmsLastSyncedAt" TIMESTAMP(3),
    "pmsRawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleanings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "cleaningType" "CleaningType" NOT NULL DEFAULT 'CHECKOUT',
    "status" "CleaningStatus" NOT NULL DEFAULT 'PENDING',
    "timeSlot" TIMESTAMP(3) NOT NULL,
    "maxCleaners" INTEGER NOT NULL DEFAULT 1,
    "managerNote" TEXT,
    "cleanerNote" TEXT,
    "supplyNote" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "checkInTime" TIMESTAMP(3) NOT NULL,
    "checkOutTime" TIMESTAMP(3),
    "accommodationName" TEXT NOT NULL,
    "numAdults" INTEGER NOT NULL DEFAULT 1,
    "numChildren" INTEGER NOT NULL DEFAULT 0,
    "channel" "BookingChannel" NOT NULL DEFAULT 'OTHER',
    "pmsLastSyncedAt" TIMESTAMP(3),
    "bookingCancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleanings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_tags" (
    "id" TEXT NOT NULL,
    "cleaningId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_stream_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT,
    "authorId" TEXT NOT NULL,
    "category" "StreamEventCategory" NOT NULL DEFAULT 'MANUAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_stream_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookings_tenantId_idx" ON "bookings"("tenantId");

-- CreateIndex
CREATE INDEX "bookings_tenantId_checkInTime_idx" ON "bookings"("tenantId", "checkInTime");

-- CreateIndex
CREATE INDEX "bookings_propertyId_idx" ON "bookings"("propertyId");

-- CreateIndex
CREATE INDEX "bookings_bookingRef_idx" ON "bookings"("bookingRef");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenantId_pmsBookingId_key" ON "bookings"("tenantId", "pmsBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "cleanings_bookingId_key" ON "cleanings"("bookingId");

-- CreateIndex
CREATE INDEX "cleanings_tenantId_idx" ON "cleanings"("tenantId");

-- CreateIndex
CREATE INDEX "cleanings_tenantId_status_idx" ON "cleanings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cleanings_tenantId_timeSlot_idx" ON "cleanings"("tenantId", "timeSlot");

-- CreateIndex
CREATE INDEX "cleanings_tenantId_checkInTime_idx" ON "cleanings"("tenantId", "checkInTime");

-- CreateIndex
CREATE INDEX "cleanings_propertyId_idx" ON "cleanings"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_tags_cleaningId_tagId_key" ON "cleaning_tags"("cleaningId", "tagId");

-- CreateIndex
CREATE INDEX "manual_stream_events_tenantId_occurredAt_idx" ON "manual_stream_events"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "manual_stream_events_tenantId_propertyId_occurredAt_idx" ON "manual_stream_events"("tenantId", "propertyId", "occurredAt");

-- CreateIndex
CREATE INDEX "manual_stream_events_tenantId_category_occurredAt_idx" ON "manual_stream_events"("tenantId", "category", "occurredAt");

-- CreateIndex
CREATE INDEX "cleaning_assignments_cleaningId_idx" ON "cleaning_assignments"("cleaningId");

-- CreateIndex
CREATE INDEX "cleaning_photos_cleaningId_idx" ON "cleaning_photos"("cleaningId");

-- CreateIndex
CREATE INDEX "incidents_bookingId_idx" ON "incidents"("bookingId");

-- CreateIndex
CREATE INDEX "incidents_cleaningId_idx" ON "incidents"("cleaningId");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanings" ADD CONSTRAINT "cleanings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanings" ADD CONSTRAINT "cleanings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanings" ADD CONSTRAINT "cleanings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "cleaning_assignments_cleaningId_fkey" FOREIGN KEY ("cleaningId") REFERENCES "cleanings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_photos" ADD CONSTRAINT "cleaning_photos_cleaningId_fkey" FOREIGN KEY ("cleaningId") REFERENCES "cleanings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_tags" ADD CONSTRAINT "cleaning_tags_cleaningId_fkey" FOREIGN KEY ("cleaningId") REFERENCES "cleanings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_tags" ADD CONSTRAINT "cleaning_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "manager_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_cleaningId_fkey" FOREIGN KEY ("cleaningId") REFERENCES "cleanings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_stream_events" ADD CONSTRAINT "manual_stream_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_stream_events" ADD CONSTRAINT "manual_stream_events_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_stream_events" ADD CONSTRAINT "manual_stream_events_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
