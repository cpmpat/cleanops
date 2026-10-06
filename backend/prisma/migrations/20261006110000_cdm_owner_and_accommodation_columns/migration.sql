-- 6 Oct 2026
-- 1. Accommodation: five columns renamed to the sheet's new header names, and
--    the new sheet columns added (five tag fields, check-in instructions link,
--    OX Point id, compHomeboook).
-- 2. Owner moves from the live sheet into Postgres (cdm_owners), so its
--    changes can be tracked and shown in Notifications → Data.

-- ─── 1a. renames ────────────────────────────────────────────────────────────
-- The sheet now uses the names the access matrix always used. Column, column
-- description, grants and history are renamed together so nothing is orphaned.
ALTER TABLE "cdm_accommodations" RENAME COLUMN "linkListingAirbnb"  TO "urlListingAirbnb";
ALTER TABLE "cdm_accommodations" RENAME COLUMN "contractTerminated" TO "dateContractTermination";
ALTER TABLE "cdm_accommodations" RENAME COLUMN "parkingLotNumber"   TO "parkingNumber";
ALTER TABLE "cdm_accommodations" RENAME COLUMN "espId"              TO "vitejEspId";
-- The sheet had two columns called urlFolderPp; the table held the first one
-- (BS). The sheet now calls them urlFolderPpOld (BS) and urlFolderPpNew (FP).
ALTER TABLE "cdm_accommodations" RENAME COLUMN "urlFolderPp"        TO "urlFolderPpOld";

WITH r(old, new) AS (VALUES
  ('linkListingAirbnb',  'urlListingAirbnb'),
  ('contractTerminated', 'dateContractTermination'),
  ('parkingLotNumber',   'parkingNumber'),
  ('espId',              'vitejEspId'),
  ('urlFolderPp',        'urlFolderPpOld')
)
UPDATE "dataset_fields" f SET "field" = r.new
FROM r WHERE f."dataset" = 'accommodation' AND f."field" = r.old;

WITH r(old, new) AS (VALUES
  ('linkListingAirbnb',  'urlListingAirbnb'),
  ('contractTerminated', 'dateContractTermination'),
  ('parkingLotNumber',   'parkingNumber'),
  ('espId',              'vitejEspId'),
  ('urlFolderPp',        'urlFolderPpOld')
)
UPDATE "dataset_field_access" a SET "field" = r.new
FROM r WHERE a."dataset" = 'accommodation' AND a."field" = r.old
  AND NOT EXISTS (
    SELECT 1 FROM "dataset_field_access" x
    WHERE x."tenantId" = a."tenantId" AND x."dataset" = a."dataset" AND x."role" = a."role" AND x."field" = r.new
  );

WITH r(old, new) AS (VALUES
  ('linkListingAirbnb',  'urlListingAirbnb'),
  ('contractTerminated', 'dateContractTermination'),
  ('parkingLotNumber',   'parkingNumber'),
  ('espId',              'vitejEspId'),
  ('urlFolderPp',        'urlFolderPpOld')
)
UPDATE "dataset_field_changes" c SET "field" = r.new
FROM r WHERE c."dataset" = 'accommodation' AND c."field" = r.old;

-- ─── 1b. new Accommodation columns ──────────────────────────────────────────
-- markField1-5: TRUE/FALSE tags for marking rows ("Tag 1" … "Tag 5").
ALTER TABLE "cdm_accommodations"
    ADD COLUMN "markField1" BOOLEAN,
    ADD COLUMN "markField2" BOOLEAN,
    ADD COLUMN "markField3" BOOLEAN,
    ADD COLUMN "markField4" BOOLEAN,
    ADD COLUMN "markField5" BOOLEAN,
    ADD COLUMN "checkInInstructionLink" TEXT,
    ADD COLUMN "oxPointId" TEXT,
    ADD COLUMN "compHomeboook" TEXT,
    ADD COLUMN "urlFolderPpNew" TEXT;

-- MANAGER and ADMIN see every column, as they do the rest of the list. Other
-- roles get these through their matrix file.
INSERT INTO "dataset_field_access" ("id", "tenantId", "dataset", "field", "role", "canView", "canEdit", "updatedAt")
SELECT gen_random_uuid()::text, t."tenantId", 'accommodation', v.field, r.role::"UserRole", true, false, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'accommodation') t
CROSS JOIN (VALUES ('markField1'), ('markField2'), ('markField3'), ('markField4'), ('markField5'),
                   ('checkInInstructionLink'), ('oxPointId'), ('compHomeboook'), ('urlFolderPpNew')) AS v(field)
CROSS JOIN (VALUES ('MANAGER'), ('ADMIN')) AS r(role)
ON CONFLICT DO NOTHING;

-- ─── 1c. pick lists: checkInMethod, terraceType ─────────────────────────────
-- Bound here; the allowed values are loaded from the data after the reload
-- (`picklist:from-data`), and can be extended any time.
UPDATE "dataset_fields" SET "picklist" = 'accommodation.' || "field"
WHERE "dataset" = 'accommodation' AND "field" IN ('checkInMethod', 'terraceType');

-- ─── 2. cdm_owners ──────────────────────────────────────────────────────────
-- All text but vatPayer, as the sheet holds them. `rowId` is the primary key
-- because the sheet has its own `id` column (Airstay ID), the natural key.
CREATE TABLE "cdm_owners" (
    "rowId"                         TEXT NOT NULL,
    "tenantId"                      TEXT NOT NULL,
    "id"                            TEXT,
    "treatment"                     TEXT,
    "name"                          TEXT,
    "surnames"                      TEXT,
    "displayName"                   TEXT,
    "language"                      TEXT,
    "email1"                        TEXT,
    "email2"                        TEXT,
    "mobile"                        TEXT,
    "city"                          TEXT,
    "country"                       TEXT,
    "postalCode"                    TEXT,
    "state"                         TEXT,
    "street"                        TEXT,
    "iban"                          TEXT,
    "vatPayer"                      BOOLEAN,
    "identifiedVatPayer"            TEXT,
    "cityTaxArea"                   TEXT,
    "ICO"                           TEXT,
    "invoiceSerial"                 TEXT,
    "receiptSerial"                 TEXT,
    "creditSerial"                  TEXT,
    "proformaSerial"                TEXT,
    "proofOfPaymentSerial"          TEXT,
    "creditOfProofOfPaymentSerial"  TEXT,
    "contractSerial"                TEXT,
    "settlementSerial"              TEXT,
    "birthNumber"                   TEXT,
    "cityTaxSubject"                TEXT,
    "cityTaxVariableSymbol"         TEXT,
    "validity"                      TEXT,
    "cityTaxEntityRegistered"       TEXT,
    "createdAt"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdm_owners_pkey" PRIMARY KEY ("rowId")
);
CREATE UNIQUE INDEX "cdm_owners_tenantId_id_key" ON "cdm_owners"("tenantId", "id");
ALTER TABLE "cdm_owners"
    ADD CONSTRAINT "cdm_owners_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MANAGER and ADMIN keep seeing every Owner column, as they did on the sheet.
-- The desk roles and EVIDENCE already hold their grants (owner.csv, loaded 2 Oct).
INSERT INTO "dataset_field_access" ("id", "tenantId", "dataset", "field", "role", "canView", "canEdit", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'owner', v.field, r.role::"UserRole", true, false, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" AS "id" FROM "dataset_fields") t
CROSS JOIN (VALUES
  ('id'), ('treatment'), ('name'), ('surnames'), ('displayName'), ('language'), ('email1'), ('email2'),
  ('mobile'), ('city'), ('country'), ('postalCode'), ('state'), ('street'), ('iban'), ('vatPayer'),
  ('identifiedVatPayer'), ('cityTaxArea'), ('ICO'), ('invoiceSerial'), ('receiptSerial'), ('creditSerial'),
  ('proformaSerial'), ('proofOfPaymentSerial'), ('creditOfProofOfPaymentSerial'), ('contractSerial'),
  ('settlementSerial'), ('birthNumber'), ('cityTaxSubject'), ('cityTaxVariableSymbol'), ('validity'),
  ('cityTaxEntityRegistered')
) AS v(field)
CROSS JOIN (VALUES ('MANAGER'), ('ADMIN')) AS r(role)
ON CONFLICT DO NOTHING;
