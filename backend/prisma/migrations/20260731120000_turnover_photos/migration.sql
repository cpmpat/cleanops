-- Photo evidence for turnovers.
--
-- Until now TurnoversService.markDone() accepted `photoUrls` from the cleaner
-- and threw them away — the request body carried them, nothing persisted them,
-- and the audit event recorded only a count. Every photo a cleaner took of a
-- problem was lost. This is the table that stops that.
--
-- Mirrors cleaning_photos, which it replaces (see CLEANINGS-RETIREMENT-PLAN.md).
-- Historical cleaning_photos rows are deliberately NOT migrated.

CREATE TABLE "turnover_photos" (
    "id"                    TEXT NOT NULL,
    "turnoverId"            TEXT NOT NULL,
    "turnoverAssignmentId"  TEXT,
    "url"                   TEXT NOT NULL,
    "caption"               TEXT,
    "uploadedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turnover_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "turnover_photos_turnoverId_idx" ON "turnover_photos"("turnoverId");

ALTER TABLE "turnover_photos"
  ADD CONSTRAINT "turnover_photos_turnoverId_fkey"
  FOREIGN KEY ("turnoverId") REFERENCES "turnovers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "turnover_photos"
  ADD CONSTRAINT "turnover_photos_turnoverAssignmentId_fkey"
  FOREIGN KEY ("turnoverAssignmentId") REFERENCES "turnover_assignments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
