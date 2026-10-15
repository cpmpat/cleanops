-- 15 Oct 2026
-- 1. Accommodation: the OX Point a unit uses, looked up from cdm_ox_point
--    (sheet columns FW–GF). Text, like the OX Point columns they copy.
ALTER TABLE "cdm_accommodations"
  ADD COLUMN "oxpointCity"                 TEXT,
  ADD COLUMN "oxpointStreet"               TEXT,
  ADD COLUMN "oxpointStreetnumber"         TEXT,
  ADD COLUMN "oxpointPostcode"             TEXT,
  ADD COLUMN "oxpointDescription"          TEXT,
  ADD COLUMN "oxpointBoxnumber"            TEXT,
  ADD COLUMN "oxpointAccesscode"           TEXT,
  ADD COLUMN "oxpointLockboxnumber"        TEXT,
  ADD COLUMN "oxpointLockboxcode"          TEXT,
  ADD COLUMN "oxpointAccessibilitysummary" TEXT;

-- 2. oxPointId picks from the OX Point list's "ID" column. A `ref:` pick list
--    reads its values from the table at request time — nothing to keep in
--    step in dataset_picklist_values.
UPDATE "dataset_fields" SET "picklist" = 'ref:oxpoint.oxId'
WHERE "dataset" = 'accommodation' AND "field" = 'oxPointId';

-- 3. OPERATIONS_ASSISTANT has FRONT_DESK_MANAGER's modules, Notifications →
--    Data included: same notify rows. (Notified only for fields the role can
--    view, as for everyone.)
INSERT INTO "dataset_field_notify" ("id", "tenantId", "dataset", "field", "role", "notify", "updatedAt")
SELECT gen_random_uuid()::text, "tenantId", "dataset", "field", 'OPERATIONS_ASSISTANT', "notify", CURRENT_TIMESTAMP
FROM "dataset_field_notify" WHERE "role" = 'FRONT_DESK_MANAGER'
ON CONFLICT ("tenantId", "dataset", "field", "role") DO NOTHING;
