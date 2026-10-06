-- 6 Oct 2026 — CDM User list brought in line with the sheet and its matrix
-- (docs/access-matrix/user.csv): four columns renamed to the sheet's header
-- names, two new ones, and User joins Notifications → Data.

ALTER TABLE "cdm_users" RENAME COLUMN "possitionTier"       TO "positionTier";
ALTER TABLE "cdm_users" RENAME COLUMN "phuneNumber"         TO "phoneNumber";
ALTER TABLE "cdm_users" RENAME COLUMN "checkinCollaborator" TO "AppCheckinCollaborator";
ALTER TABLE "cdm_users" RENAME COLUMN "address"             TO "residenceAddress";

WITH r(old, new) AS (VALUES
  ('possitionTier', 'positionTier'), ('phuneNumber', 'phoneNumber'),
  ('checkinCollaborator', 'AppCheckinCollaborator'), ('address', 'residenceAddress')
)
UPDATE "dataset_fields" f SET "field" = r.new FROM r WHERE f."dataset" = 'user' AND f."field" = r.old;

WITH r(old, new) AS (VALUES
  ('possitionTier', 'positionTier'), ('phuneNumber', 'phoneNumber'),
  ('checkinCollaborator', 'AppCheckinCollaborator'), ('address', 'residenceAddress')
)
UPDATE "dataset_field_access" a SET "field" = r.new FROM r
WHERE a."dataset" = 'user' AND a."field" = r.old
  AND NOT EXISTS (
    SELECT 1 FROM "dataset_field_access" x
    WHERE x."tenantId" = a."tenantId" AND x."dataset" = a."dataset" AND x."role" = a."role" AND x."field" = r.new
  );

WITH r(old, new) AS (VALUES
  ('possitionTier', 'positionTier'), ('phuneNumber', 'phoneNumber'),
  ('checkinCollaborator', 'AppCheckinCollaborator'), ('address', 'residenceAddress')
)
UPDATE "dataset_field_changes" c SET "field" = r.new FROM r WHERE c."dataset" = 'user' AND c."field" = r.old;

ALTER TABLE "cdm_users"
    ADD COLUMN "hr" TEXT,
    ADD COLUMN "rowOrderCreation" TEXT;

-- MANAGER and ADMIN see every User column, as they always have. ADMIN's
-- grants are then set by user.csv; the other roles only by their files.
INSERT INTO "dataset_field_access" ("id", "tenantId", "dataset", "field", "role", "canView", "canEdit", "updatedAt")
SELECT gen_random_uuid()::text, t."tenantId", 'user', v.field, r.role::"UserRole", true, false, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'user') t
CROSS JOIN (VALUES ('hr'), ('rowOrderCreation')) AS v(field)
CROSS JOIN (VALUES ('MANAGER'), ('ADMIN')) AS r(role)
ON CONFLICT DO NOTHING;

-- Notifications → Data: ADMIN and MANAGER are told about every User column
-- they can view, as for Accommodation and Owner.
INSERT INTO "dataset_field_notify" ("id", "tenantId", "dataset", "field", "role", "notify", "updatedAt")
SELECT gen_random_uuid()::text, a."tenantId", a."dataset", a."field", a."role", true, CURRENT_TIMESTAMP
FROM "dataset_field_access" a
WHERE a."dataset" = 'user' AND a."role" IN ('ADMIN', 'MANAGER') AND a."canView"
ON CONFLICT DO NOTHING;
