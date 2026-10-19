-- Agent's report after a check-in, with rated aspects of apartment readiness.
CREATE TABLE "checkin_reports" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "comment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "turnoverId" TEXT,
  "cleanerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "checkin_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checkin_reports_bookingId_key" ON "checkin_reports"("bookingId");
CREATE INDEX "checkin_reports_tenantId_submittedAt_idx" ON "checkin_reports"("tenantId", "submittedAt");
ALTER TABLE "checkin_reports"
  ADD CONSTRAINT "checkin_reports_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "checkin_ratings" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "aspect" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "comment" TEXT,
  CONSTRAINT "checkin_ratings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkin_ratings_score_check" CHECK ("score" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "checkin_ratings_reportId_aspect_key" ON "checkin_ratings"("reportId", "aspect");
ALTER TABLE "checkin_ratings"
  ADD CONSTRAINT "checkin_ratings_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "checkin_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
