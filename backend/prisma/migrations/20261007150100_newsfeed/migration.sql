-- 7 Oct 2026
-- 1. Accommodation: feeBording → feeBoarding (the sheet's header was fixed).
--    Column, description, grants, notify rows and history move together.
-- 2. Newsfeed: which news items each person has closed.
-- (1b below: codeLockBox → urlFolderPPUklid.)

ALTER TABLE "cdm_accommodations" RENAME COLUMN "feeBording" TO "feeBoarding";
UPDATE "dataset_fields"        SET "field" = 'feeBoarding' WHERE "dataset" = 'accommodation' AND "field" = 'feeBording';
UPDATE "dataset_field_access" a SET "field" = 'feeBoarding'
 WHERE a."dataset" = 'accommodation' AND a."field" = 'feeBording'
   AND NOT EXISTS (SELECT 1 FROM "dataset_field_access" x WHERE x."tenantId" = a."tenantId" AND x."dataset" = a."dataset" AND x."role" = a."role" AND x."field" = 'feeBoarding');
UPDATE "dataset_field_notify" n SET "field" = 'feeBoarding'
 WHERE n."dataset" = 'accommodation' AND n."field" = 'feeBording'
   AND NOT EXISTS (SELECT 1 FROM "dataset_field_notify" x WHERE x."tenantId" = n."tenantId" AND x."dataset" = n."dataset" AND x."role" = n."role" AND x."field" = 'feeBoarding');
UPDATE "dataset_field_changes" SET "field" = 'feeBoarding' WHERE "dataset" = 'accommodation' AND "field" = 'feeBording';

-- 1b. codeLockBox → urlFolderPPUklid. The column always held links to the
--     cleaning handover folder ("Folder PP cleaning"), not lockbox codes —
--     those are `lockboxCode`. Grants for urlFolderPPUklid were already loaded
--     from the matrix and win; leftover codeLockBox grants are dropped. Not
--     sensitive any more: it is a link.
ALTER TABLE "cdm_accommodations" RENAME COLUMN "codeLockBox" TO "urlFolderPPUklid";
UPDATE "dataset_fields" SET "field" = 'urlFolderPPUklid', "sensitive" = false, "type" = 'url'
 WHERE "dataset" = 'accommodation' AND "field" = 'codeLockBox';
DELETE FROM "dataset_field_access" a
 WHERE a."dataset" = 'accommodation' AND a."field" = 'codeLockBox'
   AND EXISTS (SELECT 1 FROM "dataset_field_access" x WHERE x."tenantId" = a."tenantId" AND x."dataset" = a."dataset" AND x."role" = a."role" AND x."field" = 'urlFolderPPUklid');
UPDATE "dataset_field_access" SET "field" = 'urlFolderPPUklid' WHERE "dataset" = 'accommodation' AND "field" = 'codeLockBox';
DELETE FROM "dataset_field_notify" n
 WHERE n."dataset" = 'accommodation' AND n."field" = 'codeLockBox'
   AND EXISTS (SELECT 1 FROM "dataset_field_notify" x WHERE x."tenantId" = n."tenantId" AND x."dataset" = n."dataset" AND x."role" = n."role" AND x."field" = 'urlFolderPPUklid');
UPDATE "dataset_field_notify" SET "field" = 'urlFolderPPUklid' WHERE "dataset" = 'accommodation' AND "field" = 'codeLockBox';
UPDATE "dataset_field_changes" SET "field" = 'urlFolderPPUklid' WHERE "dataset" = 'accommodation' AND "field" = 'codeLockBox';

-- A news item is a recorded field change that a newsfeed rule turns into a
-- sentence (backend/src/newsfeed/rules.ts), so it needs no table of its own.
-- What is stored is only who closed which item.
CREATE TABLE "newsfeed_dismissals" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "itemId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsfeed_dismissals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "newsfeed_dismissals_userId_itemId_key" ON "newsfeed_dismissals"("userId", "itemId");
CREATE INDEX "newsfeed_dismissals_tenantId_userId_idx" ON "newsfeed_dismissals"("tenantId", "userId");
ALTER TABLE "newsfeed_dismissals"
    ADD CONSTRAINT "newsfeed_dismissals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "newsfeed_dismissals"
    ADD CONSTRAINT "newsfeed_dismissals_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The feed asks for the latest change of a few fields across a list.
CREATE INDEX "dataset_field_changes_tenantId_dataset_field_createdAt_idx"
    ON "dataset_field_changes"("tenantId", "dataset", "field", "createdAt");
