-- Notifications → Data: which field changes each role is told about.
--
-- dataset_field_notify is a second matrix beside dataset_field_access:
-- role × dataset × field → notify. No row = not notified (default deny).
-- Like the access matrix it is not a foreign key to dataset_fields, so a row
-- for a column that does not exist yet simply waits for it. Notify does NOT
-- imply view: the feed only ever shows a change to a role that may also view
-- the field (checked when the feed is read).

CREATE TABLE "dataset_field_notify" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "dataset"   TEXT NOT NULL,
    "field"     TEXT NOT NULL,
    "role"      "UserRole" NOT NULL,
    "notify"    BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_field_notify_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dataset_field_notify_tenantId_dataset_field_role_key"
    ON "dataset_field_notify"("tenantId", "dataset", "field", "role");
CREATE INDEX "dataset_field_notify_tenantId_role_idx"
    ON "dataset_field_notify"("tenantId", "role");
ALTER TABLE "dataset_field_notify"
    ADD CONSTRAINT "dataset_field_notify_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The feed reads newest first across lists.
CREATE INDEX "dataset_field_changes_tenantId_createdAt_idx"
    ON "dataset_field_changes"("tenantId", "createdAt");
CREATE INDEX "dataset_field_changes_tenantId_dataset_createdAt_idx"
    ON "dataset_field_changes"("tenantId", "dataset", "createdAt");

-- Start: ADMIN and MANAGER are told about every Accommodation and Owner column
-- they can view. Every other role starts with nothing until its notify matrix
-- is loaded (docs/notify-matrix/, `import:notify-matrix`).
INSERT INTO "dataset_field_notify" ("id", "tenantId", "dataset", "field", "role", "notify", "updatedAt")
SELECT gen_random_uuid()::text, a."tenantId", a."dataset", a."field", a."role", true, CURRENT_TIMESTAMP
FROM "dataset_field_access" a
WHERE a."dataset" IN ('accommodation', 'owner')
  AND a."role" IN ('ADMIN', 'MANAGER')
  AND a."canView"
ON CONFLICT DO NOTHING;
