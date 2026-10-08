-- 8 Oct 2026 — Pricing Group: ranked pick list, and a record of every move.
--
-- 1. The ranked list. Pick list `accommodation.pricingGroup`; sortOrder is the
--    rank, 1 = highest (LUX A) … 12 = lowest (CKC). Data edits now choose from
--    it, and it is what "up" and "down" are measured against. Extend or
--    re-order it in dataset_picklist_values.
INSERT INTO "dataset_picklist_values" ("id", "tenantId", "list", "value", "sortOrder", "active", "createdAt")
SELECT gen_random_uuid()::text, t."tenantId", 'accommodation.pricingGroup', v.value, v.rank, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'accommodation') t
CROSS JOIN (VALUES
  ('LUX A', 1), ('LUX B', 2), ('LUX C', 3),
  ('Premium A', 4), ('Premium B', 5), ('Premium C', 6),
  ('Grand A', 7), ('Grand B', 8), ('Grand C', 9),
  ('CKA', 10), ('CKB', 11), ('CKC', 12)
) AS v(value, rank)
ON CONFLICT ("tenantId", "list", "value") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder", "active" = true;

UPDATE "dataset_fields" SET "picklist" = 'accommodation.pricingGroup'
WHERE "dataset" = 'accommodation' AND "field" = 'pricingGroup';

-- 2. The moves.
CREATE TABLE "pricing_group_moves" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "changeId"           TEXT NOT NULL,
    "accommodationRowId" TEXT NOT NULL,
    "idAvantio"          TEXT,
    "accommodationTitle" TEXT,
    "propertyId"         TEXT,
    "fromGroup"          TEXT,
    "toGroup"            TEXT,
    "fromRank"           INTEGER,
    "toRank"             INTEGER,
    "direction"          TEXT NOT NULL,
    "actorEmail"         TEXT,
    "actorRole"          TEXT,
    "occurredAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_group_moves_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_group_moves_changeId_key" ON "pricing_group_moves"("changeId");
CREATE INDEX "pricing_group_moves_tenantId_occurredAt_idx" ON "pricing_group_moves"("tenantId", "occurredAt");
CREATE INDEX "pricing_group_moves_tenantId_propertyId_occurredAt_idx" ON "pricing_group_moves"("tenantId", "propertyId", "occurredAt");
CREATE INDEX "pricing_group_moves_tenantId_idAvantio_occurredAt_idx" ON "pricing_group_moves"("tenantId", "idAvantio", "occurredAt");
ALTER TABLE "pricing_group_moves" ADD CONSTRAINT "pricing_group_moves_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_group_moves" ADD CONSTRAINT "pricing_group_moves_changeId_fkey"
    FOREIGN KEY ("changeId") REFERENCES "dataset_field_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_group_moves" ADD CONSTRAINT "pricing_group_moves_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Written by the database, for every recorded change of the field, whoever
--    wrote it (app save or sheet reload). Group names are matched ignoring
--    case and spaces, so "CK A" ranks as "CKA".
CREATE OR REPLACE FUNCTION "record_pricing_group_move"(change_id TEXT) RETURNS VOID AS $$
DECLARE
  c          "dataset_field_changes"%ROWTYPE;
  from_rank  INTEGER;
  to_rank    INTEGER;
  acc_avantio TEXT;
  acc_title  TEXT;
  prop_id    TEXT;
  dir        TEXT;
BEGIN
  SELECT * INTO c FROM "dataset_field_changes" WHERE "id" = change_id;
  IF NOT FOUND OR c."masked" THEN RETURN; END IF;

  SELECT "sortOrder" INTO from_rank FROM "dataset_picklist_values"
   WHERE "tenantId" = c."tenantId" AND "list" = 'accommodation.pricingGroup'
     AND lower(regexp_replace("value", '\s+', '', 'g')) = lower(regexp_replace(coalesce(c."oldValue", ''), '\s+', '', 'g'))
   LIMIT 1;
  SELECT "sortOrder" INTO to_rank FROM "dataset_picklist_values"
   WHERE "tenantId" = c."tenantId" AND "list" = 'accommodation.pricingGroup'
     AND lower(regexp_replace("value", '\s+', '', 'g')) = lower(regexp_replace(coalesce(c."newValue", ''), '\s+', '', 'g'))
   LIMIT 1;

  dir := CASE
    WHEN coalesce(trim(c."newValue"), '') = '' THEN 'CLEARED'
    WHEN coalesce(trim(c."oldValue"), '') = '' THEN 'SET'
    WHEN from_rank IS NULL OR to_rank IS NULL THEN 'UNRANKED'
    WHEN to_rank < from_rank THEN 'UP'
    WHEN to_rank > from_rank THEN 'DOWN'
    ELSE 'SAME'
  END;

  SELECT "idAvantio", "titleAvantio" INTO acc_avantio, acc_title
    FROM "cdm_accommodations" WHERE "rowId" = c."rowId";
  IF acc_avantio IS NOT NULL THEN
    SELECT "id" INTO prop_id FROM "properties"
     WHERE "tenantId" = c."tenantId" AND "pmsPropertyId" = acc_avantio LIMIT 1;
  END IF;

  INSERT INTO "pricing_group_moves" ("id", "tenantId", "changeId", "accommodationRowId", "idAvantio",
      "accommodationTitle", "propertyId", "fromGroup", "toGroup", "fromRank", "toRank", "direction",
      "actorEmail", "actorRole", "occurredAt")
  VALUES (gen_random_uuid()::text, c."tenantId", c."id", c."rowId", acc_avantio,
      acc_title, prop_id, nullif(trim(c."oldValue"), ''), nullif(trim(c."newValue"), ''), from_rank, to_rank, dir,
      c."actorEmail", c."actorRole", c."createdAt")
  ON CONFLICT ("changeId") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- A fault here must never fail the save that recorded the change: the move is
-- a by-product, the edit is the work.
CREATE OR REPLACE FUNCTION "pricing_group_move_trigger"() RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    PERFORM "record_pricing_group_move"(NEW."id");
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pricing_group_moves: change % not recorded: %', NEW."id", SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dataset_field_changes_pricing_group_move"
AFTER INSERT ON "dataset_field_changes"
FOR EACH ROW
WHEN (NEW."dataset" = 'accommodation' AND NEW."field" = 'pricingGroup')
EXECUTE FUNCTION "pricing_group_move_trigger"();

-- 4. The history already recorded becomes moves too.
SELECT "record_pricing_group_move"("id")
FROM "dataset_field_changes"
WHERE "dataset" = 'accommodation' AND "field" = 'pricingGroup'
ORDER BY "createdAt";
