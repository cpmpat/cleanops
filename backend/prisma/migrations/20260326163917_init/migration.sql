-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MANAGER', 'CLEANER');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('en', 'cs', 'ru', 'uk');

-- CreateEnum
CREATE TYPE "CleaningEventStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "CleaningType" AS ENUM ('CHECKOUT', 'MIDSTAY', 'DEEP');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('AIRBNB', 'BOOKING_COM', 'VRBO', 'EXPEDIA', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'STARTED', 'COMPLETED', 'REJECTED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_ASSIGNMENT', 'REASSIGNMENT', 'CANCELLATION', 'BOOKING_MODIFIED', 'REMINDER', 'OVERDUE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'IN_APP');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pmsProvider" TEXT,
    "pmsApiBaseUrl" TEXT,
    "pmsApiKey" TEXT,
    "pmsLastSyncAt" TIMESTAMP(3),
    "pmsSyncEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "magicLinkToken" TEXT,
    "magicLinkExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "pushSubscription" JSONB,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "defaultCleanerId" TEXT,
    "pmsPropertyId" TEXT,
    "accommodationType" TEXT,
    "pmsStatus" TEXT,
    "pmsClean" BOOLEAN NOT NULL DEFAULT false,
    "pmsLastSyncedAt" TIMESTAMP(3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "bookingRef" TEXT NOT NULL,
    "pmsBookingId" TEXT,
    "checkInTime" TIMESTAMP(3) NOT NULL,
    "checkOutTime" TIMESTAMP(3),
    "accommodationName" TEXT NOT NULL,
    "accommodationType" TEXT,
    "numAdults" INTEGER NOT NULL DEFAULT 1,
    "numChildren" INTEGER NOT NULL DEFAULT 0,
    "channel" "BookingChannel" NOT NULL DEFAULT 'OTHER',
    "cleaningType" "CleaningType" NOT NULL DEFAULT 'CHECKOUT',
    "status" "CleaningEventStatus" NOT NULL DEFAULT 'PENDING',
    "timeSlot" TIMESTAMP(3) NOT NULL,
    "managerNote" TEXT,
    "cleanerNote" TEXT,
    "supplyNote" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "pmsLastSyncedAt" TIMESTAMP(3),
    "pmsRawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaning_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_assignments" (
    "id" TEXT NOT NULL,
    "cleaningEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "rejectedReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_photos" (
    "id" TEXT NOT NULL,
    "cleaningEventId" TEXT NOT NULL,
    "cleaningAssignmentId" TEXT,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_tags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_event_tags" (
    "id" TEXT NOT NULL,
    "cleaningEventId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_event_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_magicLinkToken_key" ON "users"("magicLinkToken");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "properties_tenantId_idx" ON "properties"("tenantId");

-- CreateIndex
CREATE INDEX "properties_tenantId_pmsStatus_idx" ON "properties"("tenantId", "pmsStatus");

-- CreateIndex
CREATE UNIQUE INDEX "properties_tenantId_pmsPropertyId_key" ON "properties"("tenantId", "pmsPropertyId");

-- CreateIndex
CREATE INDEX "cleaning_events_tenantId_idx" ON "cleaning_events"("tenantId");

-- CreateIndex
CREATE INDEX "cleaning_events_tenantId_status_idx" ON "cleaning_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cleaning_events_tenantId_checkInTime_idx" ON "cleaning_events"("tenantId", "checkInTime");

-- CreateIndex
CREATE INDEX "cleaning_events_propertyId_idx" ON "cleaning_events"("propertyId");

-- CreateIndex
CREATE INDEX "cleaning_events_bookingRef_idx" ON "cleaning_events"("bookingRef");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_events_tenantId_pmsBookingId_key" ON "cleaning_events"("tenantId", "pmsBookingId");

-- CreateIndex
CREATE INDEX "cleaning_assignments_cleaningEventId_idx" ON "cleaning_assignments"("cleaningEventId");

-- CreateIndex
CREATE INDEX "cleaning_assignments_userId_idx" ON "cleaning_assignments"("userId");

-- CreateIndex
CREATE INDEX "cleaning_assignments_userId_status_idx" ON "cleaning_assignments"("userId", "status");

-- CreateIndex
CREATE INDEX "cleaning_photos_cleaningEventId_idx" ON "cleaning_photos"("cleaningEventId");

-- CreateIndex
CREATE INDEX "manager_tags_tenantId_idx" ON "manager_tags"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "manager_tags_tenantId_label_key" ON "manager_tags"("tenantId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "cleaning_event_tags_cleaningEventId_tagId_key" ON "cleaning_event_tags"("cleaningEventId", "tagId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_defaultCleanerId_fkey" FOREIGN KEY ("defaultCleanerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_events" ADD CONSTRAINT "cleaning_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_events" ADD CONSTRAINT "cleaning_events_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "cleaning_assignments_cleaningEventId_fkey" FOREIGN KEY ("cleaningEventId") REFERENCES "cleaning_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "cleaning_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_assignments" ADD CONSTRAINT "cleaning_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_photos" ADD CONSTRAINT "cleaning_photos_cleaningEventId_fkey" FOREIGN KEY ("cleaningEventId") REFERENCES "cleaning_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_photos" ADD CONSTRAINT "cleaning_photos_cleaningAssignmentId_fkey" FOREIGN KEY ("cleaningAssignmentId") REFERENCES "cleaning_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_tags" ADD CONSTRAINT "manager_tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_event_tags" ADD CONSTRAINT "cleaning_event_tags_cleaningEventId_fkey" FOREIGN KEY ("cleaningEventId") REFERENCES "cleaning_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_event_tags" ADD CONSTRAINT "cleaning_event_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "manager_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
