-- Turnover reconciliation support.
--
-- 1) skipReason distinguishes a system merge from a deliberate human skip.
--    Without it the reconciler cannot tell whether a SKIPPED row means
--    "this slot was absorbed into a merged turnover, re-thread it freely" or
--    "a human decided this unit does not need cleaning, leave it alone".
--
-- 2) Indexes for the reconciler's active-chain scans and for the supersession
--    chain walk, which had no index at all.

ALTER TABLE "turnovers" ADD COLUMN "skipReason" TEXT;

-- Backfill: as of this migration the ONLY writer of status='SKIPPED' is
-- TurnoverSyncService.mergeAcrossCancellation() — TurnoversService.update()
-- cannot set status, and cancel() writes 'CANCELLED'. So every existing
-- SKIPPED row is a system merge. If that stops being true, this assumption
-- does not hold for rows created after this migration — which is exactly why
-- the column exists.
UPDATE "turnovers"
   SET "skipReason" = 'MERGED_ON_CANCELLATION'
 WHERE "status" = 'SKIPPED'
   AND "skipReason" IS NULL;

CREATE INDEX "turnovers_supersededById_idx" ON "turnovers"("supersededById");

-- Partial indexes: every reconciler and read-path query filters on
-- supersededById IS NULL. Not expressible in schema.prisma, so they live here.
-- `prisma migrate dev` may report these as drift; keep them.
CREATE INDEX "turnovers_active_to_idx"
    ON "turnovers"("toBookingId")
 WHERE "supersededById" IS NULL;

CREATE INDEX "turnovers_active_from_idx"
    ON "turnovers"("fromBookingId")
 WHERE "supersededById" IS NULL;

-- NOT included, deliberately: the UNIQUE version of the two partial indexes
-- above. It is the right end state, but TurnoverSyncService.createTurnover()
-- inserts first and calls enforceUniqueActive() second, so a unique index
-- would make the INSERT throw before the conflict resolution runs. Moving
-- conflict detection ahead of the insert is a separate change; the reconciler
-- (run with --fail-on-drift) is the interim guard.
