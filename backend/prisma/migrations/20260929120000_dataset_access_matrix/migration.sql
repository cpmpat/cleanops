-- Dataset access matrix, pick lists and field-level change history.
--
-- 1. dataset_field_access — role × dataset × field → view / edit. No row means
--    no access (default deny). Not a foreign key to dataset_fields on purpose:
--    a grant for a column that does not exist yet waits for it.
-- 2. dataset_picklist_values — the allowed values of pick-list fields, bound
--    through dataset_fields.picklist.
-- 3. dataset_field_changes — one row per field per save, old → new, with the
--    actor's email and role; children of the save's audit_events row.

-- ─── dataset_fields.picklist ────────────────────────────────────────────────
ALTER TABLE "dataset_fields" ADD COLUMN "picklist" TEXT;

-- ─── dataset_field_access ───────────────────────────────────────────────────
CREATE TABLE "dataset_field_access" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "dataset"   TEXT NOT NULL,
    "field"     TEXT NOT NULL,
    "role"      "UserRole" NOT NULL,
    "canView"   BOOLEAN NOT NULL DEFAULT false,
    "canEdit"   BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_field_access_pkey" PRIMARY KEY ("id"),
    -- Editing a value you cannot see is not a permission anyone should have.
    CONSTRAINT "dataset_field_access_edit_needs_view" CHECK (NOT "canEdit" OR "canView")
);
CREATE UNIQUE INDEX "dataset_field_access_tenantId_dataset_field_role_key"
    ON "dataset_field_access"("tenantId", "dataset", "field", "role");
CREATE INDEX "dataset_field_access_tenantId_dataset_role_idx"
    ON "dataset_field_access"("tenantId", "dataset", "role");
ALTER TABLE "dataset_field_access"
    ADD CONSTRAINT "dataset_field_access_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── dataset_picklist_values ────────────────────────────────────────────────
CREATE TABLE "dataset_picklist_values" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "list"      TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_picklist_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dataset_picklist_values_tenantId_list_value_key"
    ON "dataset_picklist_values"("tenantId", "list", "value");
ALTER TABLE "dataset_picklist_values"
    ADD CONSTRAINT "dataset_picklist_values_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── dataset_field_changes ──────────────────────────────────────────────────
CREATE TABLE "dataset_field_changes" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "eventId"    TEXT NOT NULL,
    "dataset"    TEXT NOT NULL,
    "rowId"      TEXT NOT NULL,
    "field"      TEXT NOT NULL,
    "oldValue"   TEXT,
    "newValue"   TEXT,
    -- True for sensitive columns: the change is recorded, the values are not.
    "masked"     BOOLEAN NOT NULL DEFAULT false,
    "actorEmail" TEXT,
    "actorRole"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_field_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dataset_field_changes_tenantId_dataset_rowId_createdAt_idx"
    ON "dataset_field_changes"("tenantId", "dataset", "rowId", "createdAt");
CREATE INDEX "dataset_field_changes_eventId_idx" ON "dataset_field_changes"("eventId");
ALTER TABLE "dataset_field_changes"
    ADD CONSTRAINT "dataset_field_changes_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_field_changes"
    ADD CONSTRAINT "dataset_field_changes_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Five Accommodation columns that are new in the sheet ──────────────────
ALTER TABLE "cdm_accommodations"
    ADD COLUMN "totalBedrooms"           INTEGER,
    ADD COLUMN "totalBathrooms"          DOUBLE PRECISION,
    ADD COLUMN "orderAccommodationAdded" TEXT,
    ADD COLUMN "parkingLimits"           TEXT,
    ADD COLUMN "accommodationStandard"   TEXT;

-- Their metadata, so they appear (empty) right away; a later import:cdm run
-- upserts the sheet's labels and descriptions over these.
INSERT INTO "dataset_fields" ("id", "tenantId", "dataset", "columnOrder", "field", "displayName", "type", "picklist")
SELECT gen_random_uuid()::text, t."tenantId", 'accommodation', t.maxorder + v.ord, v.field, v.label, v.type, v.picklist
FROM (VALUES
  (1, 'totalBedrooms',           'Total bedrooms',            'int',   NULL),
  (2, 'totalBathrooms',          'Total bathrooms',           'float', NULL),
  (3, 'orderAccommodationAdded', 'Order accommodation added', 'text',  NULL),
  (4, 'parkingLimits',           'Parking limits',            'text',  NULL),
  (5, 'accommodationStandard',   'Accommodation standard',    'text',  'accommodation.accommodationStandard')
) AS v(ord, field, label, type, picklist)
CROSS JOIN (
  SELECT "tenantId", max("columnOrder") AS maxorder
  FROM "dataset_fields" WHERE "dataset" = 'accommodation' GROUP BY "tenantId"
) AS t
ON CONFLICT DO NOTHING;

-- ─── TRUE/FALSE-only text columns become boolean ───────────────────────────
-- diag:dataset-values, 29 Sep 2026: otaHousingAnywhere holds FALSE×43,
-- TRUE×33 and blanks, nothing else. From here on only TRUE/FALSE is accepted.
-- (codeLockBox is FALSE×24 plus one URL — left as text on purpose.)
ALTER TABLE "cdm_accommodations"
    ALTER COLUMN "otaHousingAnywhere" TYPE BOOLEAN
    USING CASE upper(trim("otaHousingAnywhere"))
            WHEN 'TRUE'  THEN true
            WHEN 'FALSE' THEN false
            ELSE NULL
          END;
UPDATE "dataset_fields" SET "type" = 'bool'
WHERE "dataset" = 'accommodation' AND "field" = 'otaHousingAnywhere';

-- ─── Seed: managers and admins keep exactly what they see today ─────────────
-- Every column of every migrated list, view only. Nobody edits until the
-- matrix says so.
INSERT INTO "dataset_field_access" ("id", "tenantId", "dataset", "field", "role", "canView", "canEdit", "updatedAt")
SELECT gen_random_uuid()::text, f."tenantId", f."dataset", f."field", r.role::"UserRole", true, false, CURRENT_TIMESTAMP
FROM "dataset_fields" f
CROSS JOIN (VALUES ('MANAGER'), ('ADMIN')) AS r(role)
ON CONFLICT DO NOTHING;

-- ─── Seed: front desk, Accommodation — matrixFieldsAccessRoles.csv, 29 Sep 2026
-- Four CSV names differ from the table's column names and are mapped:
-- urlListingAirbnb → linkListingAirbnb, dateContractTermination →
-- contractTerminated, parkingNumber → parkingLotNumber, vítejEspId → espId.
-- Five CSV fields have no column yet (totalBedrooms, totalBathrooms,
-- orderAccommodationAdded, parkingLimits, accommodationStandard); their grants
-- are stored and take effect when the columns are added.
INSERT INTO "dataset_field_access" ("id", "tenantId", "dataset", "field", "role", "canView", "canEdit", "updatedAt")
SELECT gen_random_uuid()::text, t."tenantId", 'accommodation', v.field, v.role::"UserRole", v.can_view, v.can_edit, CURRENT_TIMESTAMP
FROM (VALUES
  ('source', 'FRONT_DESK_MANAGER', true, false),
  ('source', 'FRONT_DESK', true, false),
  ('status', 'FRONT_DESK_MANAGER', true, false),
  ('status', 'FRONT_DESK', true, false),
  ('id', 'FRONT_DESK_MANAGER', false, false),
  ('id', 'FRONT_DESK', false, false),
  ('idBh', 'FRONT_DESK_MANAGER', false, false),
  ('idBh', 'FRONT_DESK', false, false),
  ('idAvantio', 'FRONT_DESK_MANAGER', true, false),
  ('idAvantio', 'FRONT_DESK', true, false),
  ('titleAvantio', 'FRONT_DESK_MANAGER', true, false),
  ('titleAvantio', 'FRONT_DESK', true, false),
  ('address', 'FRONT_DESK_MANAGER', true, false),
  ('address', 'FRONT_DESK', true, false),
  ('city', 'FRONT_DESK_MANAGER', true, false),
  ('city', 'FRONT_DESK', true, false),
  ('nickname', 'FRONT_DESK_MANAGER', true, false),
  ('nickname', 'FRONT_DESK', true, false),
  ('validFrom', 'FRONT_DESK_MANAGER', true, false),
  ('validFrom', 'FRONT_DESK', true, false),
  ('feeFinalCleaningVatIncl', 'FRONT_DESK_MANAGER', true, false),
  ('feeFinalCleaningVatIncl', 'FRONT_DESK', true, false),
  ('feeFinalCleaningVatExl', 'FRONT_DESK_MANAGER', false, false),
  ('feeFinalCleaningVatExl', 'FRONT_DESK', false, false),
  ('feeFinalCleaningVatRate', 'FRONT_DESK_MANAGER', false, false),
  ('feeFinalCleaningVatRate', 'FRONT_DESK', false, false),
  ('maximumRelease', 'FRONT_DESK_MANAGER', true, false),
  ('maximumRelease', 'FRONT_DESK', true, false),
  ('otaBooking', 'FRONT_DESK_MANAGER', true, false),
  ('otaBooking', 'FRONT_DESK', true, false),
  ('otaAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('otaAirbnb', 'FRONT_DESK', true, false),
  ('sizeM2', 'FRONT_DESK_MANAGER', true, false),
  ('sizeM2', 'FRONT_DESK', true, true),
  ('capacity', 'FRONT_DESK_MANAGER', true, true),
  ('capacity', 'FRONT_DESK', true, true),
  ('bedrooms', 'FRONT_DESK_MANAGER', true, true),
  ('bedrooms', 'FRONT_DESK', true, true),
  ('bathrooms', 'FRONT_DESK_MANAGER', true, true),
  ('bathrooms', 'FRONT_DESK', true, true),
  ('category', 'FRONT_DESK_MANAGER', true, false),
  ('category', 'FRONT_DESK', true, false),
  ('bedroom', 'FRONT_DESK_MANAGER', true, false),
  ('bedroom', 'FRONT_DESK', true, false),
  ('bathroom', 'FRONT_DESK_MANAGER', true, false),
  ('bathroom', 'FRONT_DESK', true, false),
  ('bedroom2', 'FRONT_DESK_MANAGER', true, false),
  ('bedroom2', 'FRONT_DESK', true, false),
  ('bathroom2', 'FRONT_DESK_MANAGER', true, false),
  ('bathroom2', 'FRONT_DESK', true, false),
  ('type', 'FRONT_DESK_MANAGER', true, false),
  ('type', 'FRONT_DESK', true, false),
  ('floor', 'FRONT_DESK_MANAGER', true, true),
  ('floor', 'FRONT_DESK', true, true),
  ('elevator', 'FRONT_DESK_MANAGER', true, true),
  ('elevator', 'FRONT_DESK', true, true),
  ('bed', 'FRONT_DESK_MANAGER', true, true),
  ('bed', 'FRONT_DESK', true, true),
  ('bed2', 'FRONT_DESK_MANAGER', true, true),
  ('bed2', 'FRONT_DESK', true, true),
  ('layout', 'FRONT_DESK_MANAGER', true, false),
  ('layout', 'FRONT_DESK', true, false),
  ('feeAirstay', 'FRONT_DESK_MANAGER', false, false),
  ('feeAirstay', 'FRONT_DESK', false, false),
  ('feePms', 'FRONT_DESK_MANAGER', true, false),
  ('feePms', 'FRONT_DESK', true, false),
  ('feeAdmin', 'FRONT_DESK_MANAGER', true, false),
  ('feeAdmin', 'FRONT_DESK', true, false),
  ('feeBording', 'FRONT_DESK_MANAGER', true, false),
  ('feeBording', 'FRONT_DESK', true, false),
  ('feeChannelManager', 'FRONT_DESK_MANAGER', true, false),
  ('feeChannelManager', 'FRONT_DESK', true, false),
  ('emailGmail', 'FRONT_DESK_MANAGER', true, false),
  ('emailGmail', 'FRONT_DESK', true, false),
  ('passwordGmail', 'FRONT_DESK_MANAGER', true, false),
  ('passwordGmail', 'FRONT_DESK', true, false),
  ('maximumTimeRelease', 'FRONT_DESK_MANAGER', true, true),
  ('maximumTimeRelease', 'FRONT_DESK', true, false),
  ('propertyFactWifiName', 'FRONT_DESK_MANAGER', true, true),
  ('propertyFactWifiName', 'FRONT_DESK', true, true),
  ('contract', 'FRONT_DESK_MANAGER', false, false),
  ('contract', 'FRONT_DESK', false, false),
  ('mlos', 'FRONT_DESK_MANAGER', true, false),
  ('mlos', 'FRONT_DESK', true, false),
  ('contractSubject', 'FRONT_DESK_MANAGER', true, false),
  ('contractSubject', 'FRONT_DESK', true, false),
  ('cotractType', 'FRONT_DESK_MANAGER', true, false),
  ('cotractType', 'FRONT_DESK', true, false),
  ('checkInType', 'FRONT_DESK_MANAGER', true, false),
  ('checkInType', 'FRONT_DESK', true, false),
  ('petsAllowed', 'FRONT_DESK_MANAGER', true, false),
  ('petsAllowed', 'FRONT_DESK', true, false),
  ('terrace', 'FRONT_DESK_MANAGER', true, false),
  ('terrace', 'FRONT_DESK', true, false),
  ('balcony', 'FRONT_DESK_MANAGER', true, false),
  ('balcony', 'FRONT_DESK', true, false),
  ('unit', 'FRONT_DESK_MANAGER', true, false),
  ('unit', 'FRONT_DESK', true, false),
  ('emailAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('emailAirbnb', 'FRONT_DESK', true, false),
  ('passwordAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('passwordAirbnb', 'FRONT_DESK', true, false),
  ('emailBooking', 'FRONT_DESK_MANAGER', true, false),
  ('emailBooking', 'FRONT_DESK', true, false),
  ('passwordBooking', 'FRONT_DESK_MANAGER', true, false),
  ('passwordBooking', 'FRONT_DESK', true, false),
  ('emailExpedia', 'FRONT_DESK_MANAGER', true, false),
  ('emailExpedia', 'FRONT_DESK', true, false),
  ('cityTaxVariableSymbol', 'FRONT_DESK_MANAGER', true, false),
  ('cityTaxVariableSymbol', 'FRONT_DESK', true, false),
  ('feeTransactionCityTax', 'FRONT_DESK_MANAGER', false, false),
  ('feeTransactionCityTax', 'FRONT_DESK', false, false),
  ('feeExtraPerson', 'FRONT_DESK_MANAGER', true, false),
  ('feeExtraPerson', 'FRONT_DESK', true, false),
  ('ubyportApiPassword', 'FRONT_DESK_MANAGER', false, false),
  ('ubyportApiPassword', 'FRONT_DESK', false, false),
  ('ubyportApiLogin', 'FRONT_DESK_MANAGER', false, false),
  ('ubyportApiLogin', 'FRONT_DESK', false, false),
  ('ubyportIdub', 'FRONT_DESK_MANAGER', false, false),
  ('ubyportIdub', 'FRONT_DESK', false, false),
  ('ubyportManualLogin', 'FRONT_DESK_MANAGER', false, false),
  ('ubyportManualLogin', 'FRONT_DESK', false, false),
  ('ubyportManualPassword', 'FRONT_DESK_MANAGER', false, false),
  ('ubyportManualPassword', 'FRONT_DESK', false, false),
  ('accountIdAirbnb', 'FRONT_DESK_MANAGER', false, false),
  ('accountIdAirbnb', 'FRONT_DESK', false, false),
  ('cancelationPolicyAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('cancelationPolicyAirbnb', 'FRONT_DESK', true, false),
  ('urlHomebook', 'FRONT_DESK_MANAGER', true, false),
  ('urlHomebook', 'FRONT_DESK', true, false),
  ('urlFolderHouseRules', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderHouseRules', 'FRONT_DESK', true, false),
  ('salesRentalDivision', 'FRONT_DESK_MANAGER', true, false),
  ('salesRentalDivision', 'FRONT_DESK', true, false),
  ('keysQuantity', 'FRONT_DESK_MANAGER', true, false),
  ('keysQuantity', 'FRONT_DESK', true, false),
  ('urlFolderFacility', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderFacility', 'FRONT_DESK', true, false),
  ('urlFolderContractAndPoa', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderContractAndPoa', 'FRONT_DESK', true, false),
  ('urlFolderPp', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderPp', 'FRONT_DESK', true, false),
  ('urlCalculation', 'FRONT_DESK_MANAGER', false, false),
  ('urlCalculation', 'FRONT_DESK', false, false),
  ('pricing', 'FRONT_DESK_MANAGER', false, false),
  ('pricing', 'FRONT_DESK', false, false),
  ('urlFolderphotos', 'FRONT_DESK_MANAGER', false, false),
  ('urlFolderphotos', 'FRONT_DESK', false, false),
  ('urlFolderUnitOld', 'FRONT_DESK_MANAGER', false, false),
  ('urlFolderUnitOld', 'FRONT_DESK', false, false),
  ('urlFolderphotographer', 'FRONT_DESK_MANAGER', false, false),
  ('urlFolderphotographer', 'FRONT_DESK', false, false),
  ('codeLockBox', 'FRONT_DESK_MANAGER', true, false),
  ('codeLockBox', 'FRONT_DESK', true, false),
  ('otaExpedia', 'FRONT_DESK_MANAGER', true, false),
  ('otaExpedia', 'FRONT_DESK', true, false),
  ('otaVrbo', 'FRONT_DESK_MANAGER', true, false),
  ('otaVrbo', 'FRONT_DESK', true, false),
  ('listingIdAirbnb2', 'FRONT_DESK_MANAGER', false, false),
  ('listingIdAirbnb2', 'FRONT_DESK', false, false),
  ('propertyIdBooking', 'FRONT_DESK_MANAGER', false, false),
  ('propertyIdBooking', 'FRONT_DESK', false, false),
  ('petsFee', 'FRONT_DESK_MANAGER', true, false),
  ('petsFee', 'FRONT_DESK', true, false),
  ('pricingGroup', 'FRONT_DESK_MANAGER', false, false),
  ('pricingGroup', 'FRONT_DESK', false, false),
  ('linkListingAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('linkListingAirbnb', 'FRONT_DESK', true, false),
  ('urlListingBooking', 'FRONT_DESK_MANAGER', true, false),
  ('urlListingBooking', 'FRONT_DESK', true, false),
  ('listingIdAirbnbPrimary', 'FRONT_DESK_MANAGER', true, false),
  ('listingIdAirbnbPrimary', 'FRONT_DESK', true, false),
  ('parking', 'FRONT_DESK_MANAGER', true, false),
  ('parking', 'FRONT_DESK', true, false),
  ('listingDescriptionAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('listingDescriptionAirbnb', 'FRONT_DESK', true, false),
  ('pricingOffsetPriceLabs', 'FRONT_DESK_MANAGER', false, false),
  ('pricingOffsetPriceLabs', 'FRONT_DESK', false, false),
  ('pricingOffsetAirbnb', 'FRONT_DESK_MANAGER', false, false),
  ('pricingOffsetAirbnb', 'FRONT_DESK', false, false),
  ('pricingOffsetBookingAvantio', 'FRONT_DESK_MANAGER', false, false),
  ('pricingOffsetBookingAvantio', 'FRONT_DESK', false, false),
  ('stornoConditionsAirbnb', 'FRONT_DESK_MANAGER', true, false),
  ('stornoConditionsAirbnb', 'FRONT_DESK', true, false),
  ('costPricelabs', 'FRONT_DESK_MANAGER', false, false),
  ('costPricelabs', 'FRONT_DESK', false, false),
  ('costAvantio', 'FRONT_DESK_MANAGER', false, false),
  ('costAvantio', 'FRONT_DESK', false, false),
  ('supplierFinalCleaning', 'FRONT_DESK_MANAGER', false, false),
  ('supplierFinalCleaning', 'FRONT_DESK', false, false),
  ('otaAirbnbSalesStarted', 'FRONT_DESK_MANAGER', true, false),
  ('otaAirbnbSalesStarted', 'FRONT_DESK', true, false),
  ('otaBookingSalesStarted', 'FRONT_DESK_MANAGER', true, false),
  ('otaBookingSalesStarted', 'FRONT_DESK', true, false),
  ('otaExpediaSaleStarted', 'FRONT_DESK_MANAGER', true, false),
  ('otaExpediaSaleStarted', 'FRONT_DESK', true, false),
  ('otaHomeAwaySaleStarted', 'FRONT_DESK_MANAGER', true, false),
  ('otaHomeAwaySaleStarted', 'FRONT_DESK', true, false),
  ('buildingUnderConstruction', 'FRONT_DESK_MANAGER', true, true),
  ('buildingUnderConstruction', 'FRONT_DESK', true, true),
  ('otaHousingAnywhere', 'FRONT_DESK_MANAGER', true, false),
  ('otaHousingAnywhere', 'FRONT_DESK', true, false),
  ('roomIdBooking', 'FRONT_DESK_MANAGER', true, false),
  ('roomIdBooking', 'FRONT_DESK', true, false),
  ('groupRd', 'FRONT_DESK_MANAGER', true, false),
  ('groupRd', 'FRONT_DESK', true, false),
  ('validUntil', 'FRONT_DESK_MANAGER', false, false),
  ('validUntil', 'FRONT_DESK', false, false),
  ('rajonUserId', 'FRONT_DESK_MANAGER', false, false),
  ('rajonUserId', 'FRONT_DESK', false, false),
  ('rajonUserId1', 'FRONT_DESK_MANAGER', false, false),
  ('rajonUserId1', 'FRONT_DESK', false, false),
  ('rajonUserId2', 'FRONT_DESK_MANAGER', false, false),
  ('rajonUserId2', 'FRONT_DESK', false, false),
  ('airbnbUrlPriceSettingsFees', 'FRONT_DESK_MANAGER', false, false),
  ('airbnbUrlPriceSettingsFees', 'FRONT_DESK', false, false),
  ('maxWithoutSupplement', 'FRONT_DESK_MANAGER', false, false),
  ('maxWithoutSupplement', 'FRONT_DESK', false, false),
  ('notes', 'FRONT_DESK_MANAGER', false, false),
  ('notes', 'FRONT_DESK', false, false),
  ('otaVrboSalesStarted', 'FRONT_DESK_MANAGER', true, false),
  ('otaVrboSalesStarted', 'FRONT_DESK', true, false),
  ('ownerVatPayer', 'FRONT_DESK_MANAGER', false, false),
  ('ownerVatPayer', 'FRONT_DESK', false, false),
  ('cityTaxDistrictReportedTo', 'FRONT_DESK_MANAGER', true, false),
  ('cityTaxDistrictReportedTo', 'FRONT_DESK', true, false),
  ('cityTaxEntityRegistered', 'FRONT_DESK_MANAGER', true, false),
  ('cityTaxEntityRegistered', 'FRONT_DESK', true, false),
  ('costChekin', 'FRONT_DESK_MANAGER', false, false),
  ('costChekin', 'FRONT_DESK', false, false),
  ('contractSigned', 'FRONT_DESK_MANAGER', true, false),
  ('contractSigned', 'FRONT_DESK', true, false),
  ('contractTerminated', 'FRONT_DESK_MANAGER', true, false),
  ('contractTerminated', 'FRONT_DESK', true, false),
  ('chekin', 'FRONT_DESK_MANAGER', false, false),
  ('chekin', 'FRONT_DESK', false, false),
  ('cityTaxConsolidateReport', 'FRONT_DESK_MANAGER', false, false),
  ('cityTaxConsolidateReport', 'FRONT_DESK', false, false),
  ('countOccuranceOfcityTaxEntityRegistredEntity', 'FRONT_DESK_MANAGER', false, false),
  ('countOccuranceOfcityTaxEntityRegistredEntity', 'FRONT_DESK', false, false),
  ('urlFolderUnit', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderUnit', 'FRONT_DESK', true, false),
  ('folderUnitPropertiesStatus', 'FRONT_DESK_MANAGER', false, false),
  ('folderUnitPropertiesStatus', 'FRONT_DESK', false, false),
  ('folderUnitPropertiesInternalId', 'FRONT_DESK_MANAGER', false, false),
  ('folderUnitPropertiesInternalId', 'FRONT_DESK', false, false),
  ('folderUnitPropertiesCityTaxEntityRegistered', 'FRONT_DESK_MANAGER', false, false),
  ('folderUnitPropertiesCityTaxEntityRegistered', 'FRONT_DESK', false, false),
  ('folderUnitPropertiesCityTaxDistrictReportedTo', 'FRONT_DESK_MANAGER', false, false),
  ('folderUnitPropertiesCityTaxDistrictReportedTo', 'FRONT_DESK', false, false),
  ('urlFolderEvidence', 'FRONT_DESK_MANAGER', false, false),
  ('urlFolderEvidence', 'FRONT_DESK', false, false),
  ('urlFolderCityTax', 'FRONT_DESK_MANAGER', false, false),
  ('urlFolderCityTax', 'FRONT_DESK', false, false),
  ('urlSharedFolderCityTaxDistrict', 'FRONT_DESK_MANAGER', false, false),
  ('urlSharedFolderCityTaxDistrict', 'FRONT_DESK', false, false),
  ('otaBookingSalesEnded', 'FRONT_DESK_MANAGER', true, false),
  ('otaBookingSalesEnded', 'FRONT_DESK', true, false),
  ('otaAirbnbSalesEnded', 'FRONT_DESK_MANAGER', true, false),
  ('otaAirbnbSalesEnded', 'FRONT_DESK', true, false),
  ('dateOffboard', 'FRONT_DESK_MANAGER', true, false),
  ('dateOffboard', 'FRONT_DESK', true, false),
  ('propertyFactWifiPassword', 'FRONT_DESK_MANAGER', true, true),
  ('propertyFactWifiPassword', 'FRONT_DESK', true, true),
  ('parkingLotNumber', 'FRONT_DESK_MANAGER', true, false),
  ('parkingLotNumber', 'FRONT_DESK', true, false),
  ('hostsName', 'FRONT_DESK_MANAGER', false, false),
  ('hostsName', 'FRONT_DESK', false, false),
  ('finalCleaningProvided', 'FRONT_DESK_MANAGER', true, false),
  ('finalCleaningProvided', 'FRONT_DESK', true, false),
  ('additionalInvoicing', 'FRONT_DESK_MANAGER', true, false),
  ('additionalInvoicing', 'FRONT_DESK', true, false),
  ('routerModel', 'FRONT_DESK_MANAGER', true, false),
  ('routerModel', 'FRONT_DESK', true, false),
  ('intercomModel', 'FRONT_DESK_MANAGER', true, false),
  ('intercomModel', 'FRONT_DESK', true, false),
  ('intercomOperating', 'FRONT_DESK_MANAGER', true, false),
  ('intercomOperating', 'FRONT_DESK', true, false),
  ('bellLabel', 'FRONT_DESK_MANAGER', true, true),
  ('bellLabel', 'FRONT_DESK', true, false),
  ('espId', 'FRONT_DESK_MANAGER', false, false),
  ('espId', 'FRONT_DESK', false, false),
  ('vitejBoxGateUrl', 'FRONT_DESK_MANAGER', true, false),
  ('vitejBoxGateUrl', 'FRONT_DESK', true, false),
  ('ownerAvantioPortalUser', 'FRONT_DESK_MANAGER', false, false),
  ('ownerAvantioPortalUser', 'FRONT_DESK', false, false),
  ('apaPropertyId', 'FRONT_DESK_MANAGER', false, false),
  ('apaPropertyId', 'FRONT_DESK', false, false),
  ('contractSubjectEqualsOwnerApiKn', 'FRONT_DESK_MANAGER', false, false),
  ('contractSubjectEqualsOwnerApiKn', 'FRONT_DESK', false, false),
  ('listingAirbnbTitle', 'FRONT_DESK_MANAGER', true, false),
  ('listingAirbnbTitle', 'FRONT_DESK', true, false),
  ('lockboxCode', 'FRONT_DESK_MANAGER', true, false),
  ('lockboxCode', 'FRONT_DESK', true, false),
  ('tvModel', 'FRONT_DESK_MANAGER', false, false),
  ('tvModel', 'FRONT_DESK', false, false),
  ('allowedSpendingForRepairs', 'FRONT_DESK_MANAGER', true, true),
  ('allowedSpendingForRepairs', 'FRONT_DESK', true, false),
  ('parkingType', 'FRONT_DESK_MANAGER', true, false),
  ('parkingType', 'FRONT_DESK', true, false),
  ('contractVersion', 'FRONT_DESK_MANAGER', true, false),
  ('contractVersion', 'FRONT_DESK', true, false),
  ('urlFolderDesign', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderDesign', 'FRONT_DESK', true, false),
  ('urlFolderPPPrevzeti', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderPPPrevzeti', 'FRONT_DESK', true, false),
  ('urlContract', 'FRONT_DESK_MANAGER', true, false),
  ('urlContract', 'FRONT_DESK', true, false),
  ('urlInventoryFolder', 'FRONT_DESK_MANAGER', true, false),
  ('urlInventoryFolder', 'FRONT_DESK', true, false),
  ('terraceType', 'FRONT_DESK_MANAGER', true, false),
  ('terraceType', 'FRONT_DESK', true, false),
  ('checkInMethod', 'FRONT_DESK_MANAGER', true, false),
  ('checkInMethod', 'FRONT_DESK', true, false),
  ('standard', 'FRONT_DESK_MANAGER', true, false),
  ('standard', 'FRONT_DESK', true, false),
  ('contactBuildingManagement', 'FRONT_DESK_MANAGER', true, true),
  ('contactBuildingManagement', 'FRONT_DESK', true, true),
  ('urlTechnicalInformation', 'FRONT_DESK_MANAGER', true, false),
  ('urlTechnicalInformation', 'FRONT_DESK', true, false),
  ('urlFolderPhotos', 'FRONT_DESK_MANAGER', true, false),
  ('urlFolderPhotos', 'FRONT_DESK', true, false),
  ('costCleanerPayout', 'FRONT_DESK_MANAGER', false, false),
  ('costCleanerPayout', 'FRONT_DESK', false, false),
  ('sumUp', 'FRONT_DESK_MANAGER', true, false),
  ('sumUp', 'FRONT_DESK', true, false),
  ('invoicingProcess', 'FRONT_DESK_MANAGER', true, false),
  ('invoicingProcess', 'FRONT_DESK', true, false),
  ('totalBedrooms', 'FRONT_DESK_MANAGER', true, false),
  ('totalBedrooms', 'FRONT_DESK', true, false),
  ('totalBathrooms', 'FRONT_DESK_MANAGER', true, false),
  ('totalBathrooms', 'FRONT_DESK', true, false),
  ('orderAccommodationAdded', 'FRONT_DESK_MANAGER', true, false),
  ('orderAccommodationAdded', 'FRONT_DESK', true, false),
  ('parkingLimits', 'FRONT_DESK_MANAGER', true, false),
  ('parkingLimits', 'FRONT_DESK', true, false),
  ('accommodationStandard', 'FRONT_DESK_MANAGER', true, true),
  ('accommodationStandard', 'FRONT_DESK', true, true)
) AS v(field, role, can_view, can_edit)
CROSS JOIN (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'accommodation') AS t
ON CONFLICT DO NOTHING;

-- ─── Seed: pick lists ───────────────────────────────────────────────────────
INSERT INTO "dataset_picklist_values" ("id", "tenantId", "list", "value", "sortOrder")
SELECT gen_random_uuid()::text, t."tenantId", v.list, v.value, v.ord
FROM (VALUES
  ('accommodation.source', 'Avantio',     1),
  ('accommodation.source', 'CRM',         2),
  ('accommodation.source', 'Lead',        3),
  ('accommodation.status', 'Valid',       1),
  ('accommodation.status', 'Invalid',     2),
  ('accommodation.status', 'Offboarding', 3),
  ('accommodation.status', 'Offboarded',  4),
  ('accommodation.status', 'Onboarding',  5)
) AS v(list, value, ord)
CROSS JOIN (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'accommodation') AS t
ON CONFLICT DO NOTHING;

UPDATE "dataset_fields"
SET "picklist" = 'accommodation.' || "field"
WHERE "dataset" = 'accommodation' AND "field" IN ('source', 'status');
