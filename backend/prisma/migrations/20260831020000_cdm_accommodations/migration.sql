-- The Accomodation list moves into Postgres, plus the two things a
-- 164-column table needs to be usable: a family per column so the viewer can
-- tint it, and per-role overrides so each role can put related columns
-- together.

-- ─── dataset_fields.group ──────────────────────────────────────────────────
-- Purely visual. Permission stays in `sensitive`, which this does not touch.

ALTER TABLE "dataset_fields" ADD COLUMN "group" TEXT;

-- ─── dataset_field_roles ───────────────────────────────────────────────────
-- Sparse: a row exists only where a role wants a column somewhere else or out
-- of the way. No row means the base order from dataset_fields.
--
-- Deliberately cannot reveal anything: there is no column here that could
-- un-hide a `sensitive` field.

CREATE TABLE "dataset_field_roles" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "fieldId"     TEXT NOT NULL,
    "role"        "UserRole" NOT NULL,
    "columnOrder" INTEGER,
    "hidden"      BOOLEAN,

    CONSTRAINT "dataset_field_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dataset_field_roles_fieldId_role_key" ON "dataset_field_roles"("fieldId", "role");
CREATE INDEX "dataset_field_roles_tenantId_role_idx" ON "dataset_field_roles"("tenantId", "role");

ALTER TABLE "dataset_field_roles"
    ADD CONSTRAINT "dataset_field_roles_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dataset_field_roles"
    ADD CONSTRAINT "dataset_field_roles_fieldId_fkey"
    FOREIGN KEY ("fieldId") REFERENCES "dataset_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── cdm_accommodations ────────────────────────────────────────────────────
-- 164 columns. The primary key is "rowId" because the sheet has its own column
-- called "id". "idAvantio" is the natural key.

CREATE TABLE "cdm_accommodations" (
    "rowId"    TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source"                                         TEXT,
    "status"                                         TEXT,
    "id"                                             TEXT,
    "idBh"                                           TEXT,
    "idAvantio"                                      TEXT,
    "titleAvantio"                                   TEXT,
    "address"                                        TEXT,
    "city"                                           TEXT,
    "nickname"                                       TEXT,
    "validFrom"                                      TIMESTAMP(3),
    "feeFinalCleaningVatIncl"                        INTEGER,
    "feeFinalCleaningVatExl"                         TEXT,
    "feeFinalCleaningVatRate"                        TEXT,
    "maximumRelease"                                 INTEGER,
    "otaBooking"                                     BOOLEAN,
    "otaAirbnb"                                      BOOLEAN,
    "sizeM2"                                         INTEGER,
    "capacity"                                       TEXT,
    "bedrooms"                                       INTEGER,
    "bathrooms"                                      DOUBLE PRECISION,
    "category"                                       TEXT,
    "bedroom"                                        TEXT,
    "bathroom"                                       TEXT,
    "bedroom2"                                       TEXT,
    "bathroom2"                                      TEXT,
    "type"                                           TEXT,
    "floor"                                          INTEGER,
    "elevator"                                       BOOLEAN,
    "bed"                                            TEXT,
    "bed2"                                           TEXT,
    "layout"                                         TEXT,
    "feeAirstay"                                     TEXT,
    "feePms"                                         INTEGER,
    "feeAdmin"                                       INTEGER,
    "feeBording"                                     INTEGER,
    "feeChannelManager"                              INTEGER,
    "emailGmail"                                     TEXT,
    "passwordGmail"                                  TEXT,
    "maximumTimeRelease"                             TEXT,
    "propertyFactWifiName"                           TEXT,
    "contract"                                       TEXT,
    "mlos"                                           INTEGER,
    "contractSubject"                                TEXT,
    "cotractType"                                    TEXT,
    "checkInType"                                    TEXT,
    "petsAllowed"                                    BOOLEAN,
    "terrace"                                        BOOLEAN,
    "balcony"                                        BOOLEAN,
    "unit"                                           TEXT,
    "emailAirbnb"                                    TEXT,
    "passwordAirbnb"                                 TEXT,
    "emailBooking"                                   TEXT,
    "passwordBooking"                                TEXT,
    "emailExpedia"                                   TEXT,
    "cityTaxVariableSymbol"                          TEXT,
    "feeTransactionCityTax"                          TEXT,
    "feeExtraPerson"                                 INTEGER,
    "ubyportApiPassword"                             TEXT,
    "ubyportApiLogin"                                TEXT,
    "ubyportIdub"                                    TEXT,
    "ubyportManualLogin"                             TEXT,
    "ubyportManualPassword"                          TEXT,
    "accountIdAirbnb"                                TEXT,
    "cancelationPolicyAirbnb"                        TEXT,
    "urlHomebook"                                    TEXT,
    "urlFolderHouseRules"                            TEXT,
    "salesRentalDivision"                            TEXT,
    "keysQuantity"                                   TEXT,
    "urlFolderFacility"                              TEXT,
    "urlFolderContractAndPoa"                        TEXT,
    "urlFolderPp"                                    TEXT,
    "urlCalculation"                                 TEXT,
    "pricing"                                        TEXT,
    "urlFolderphotos"                                TEXT,
    "urlFolderUnitOld"                               TEXT,
    "urlFolderphotographer"                          TEXT,
    "codeLockBox"                                    TEXT,
    "otaExpedia"                                     BOOLEAN,
    "otaVrbo"                                        BOOLEAN,
    "listingIdAirbnb2"                               TEXT,
    "propertyIdBooking"                              TEXT,
    "petsFee"                                        TEXT,
    "pricingGroup"                                   TEXT,
    "linkListingAirbnb"                              TEXT,
    "urlListingBooking"                              TEXT,
    "listingIdAirbnbPrimary"                         TEXT,
    "parking"                                        BOOLEAN,
    "listingDescriptionAirbnb"                       TEXT,
    "pricingOffsetPriceLabs"                         TEXT,
    "pricingOffsetAirbnb"                            TEXT,
    "pricingOffsetBookingAvantio"                    TEXT,
    "stornoConditionsAirbnb"                         TEXT,
    "costPricelabs"                                  TEXT,
    "costAvantio"                                    DECIMAL(12,2),
    "supplierFinalCleaning"                          TEXT,
    "otaAirbnbSalesStarted"                          TIMESTAMP(3),
    "otaBookingSalesStarted"                         TIMESTAMP(3),
    "otaExpediaSaleStarted"                          TIMESTAMP(3),
    "otaHomeAwaySaleStarted"                         TIMESTAMP(3),
    "buildingUnderConstruction"                      TEXT,
    "otaHousingAnywhere"                             TEXT,
    "roomIdBooking"                                  TEXT,
    "groupRd"                                        TEXT,
    "validUntil"                                     TIMESTAMP(3),
    "rajonUserId"                                    TEXT,
    "rajonUserId1"                                   TEXT,
    "rajonUserId2"                                   TEXT,
    "airbnbUrlPriceSettingsFees"                     TEXT,
    "maxWithoutSupplement"                           TEXT,
    "notes"                                          TEXT,
    "otaVrboSalesStarted"                            TIMESTAMP(3),
    "ownerVatPayer"                                  BOOLEAN,
    "cityTaxDistrictReportedTo"                      TEXT,
    "cityTaxEntityRegistered"                        TEXT,
    "costChekin"                                     DECIMAL(12,2),
    "contractSigned"                                 TIMESTAMP(3),
    "contractTerminated"                             TIMESTAMP(3),
    "chekin"                                         BOOLEAN,
    "cityTaxConsolidateReport"                       BOOLEAN,
    "countOccuranceOfcityTaxEntityRegistredEntity"   INTEGER,
    "urlFolderUnit"                                  TEXT,
    "folderUnitPropertiesStatus"                     TEXT,
    "folderUnitPropertiesInternalId"                 TEXT,
    "folderUnitPropertiesCityTaxEntityRegistered"    TEXT,
    "folderUnitPropertiesCityTaxDistrictReportedTo"  TEXT,
    "urlFolderEvidence"                              TEXT,
    "urlFolderCityTax"                               TEXT,
    "urlSharedFolderCityTaxDistrict"                 TEXT,
    "otaBookingSalesEnded"                           TIMESTAMP(3),
    "otaAirbnbSalesEnded"                            TIMESTAMP(3),
    "dateOffboard"                                   TIMESTAMP(3),
    "propertyFactWifiPassword"                       TEXT,
    "parkingLotNumber"                               INTEGER,
    "hostsName"                                      TEXT,
    "finalCleaningProvided"                          BOOLEAN,
    "routerModel"                                    TEXT,
    "intercomModel"                                  TEXT,
    "intercomOperating"                              TEXT,
    "bellLabel"                                      TEXT,
    "espId"                                          TEXT,
    "vitejBoxGateUrl"                                TEXT,
    "ownerAvantioPortalUser"                         TEXT,
    "apaPropertyId"                                  TEXT,
    "contractSubjectEqualsOwnerApiKn"                TEXT,
    "listingAirbnbTitle"                             TEXT,
    "lockboxCode"                                    TEXT,
    "tvModel"                                        TEXT,
    "allowedSpendingForRepairs"                      TEXT,
    "parkingType"                                    TEXT,
    "contractVersion"                                TEXT,
    "urlFolderDesign"                                TEXT,
    "urlFolderPPPrevzetí"                            TEXT,
    "urlContract"                                    TEXT,
    "urlInventoryFolder"                             TEXT,
    "terraceType"                                    TEXT,
    "checkInMethod"                                  TEXT,
    "standard"                                       TEXT,
    "contactBuildingManagement"                      TEXT,
    "urlTechnicalInformation"                        TEXT,
    "urlFolderPhotos"                                TEXT,
    "costCleanerPayout"                              TEXT,
    "sumUp"                                          TEXT,
    "invoicingProcess"                               TEXT,
    "additionalInvoicing"                            TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdm_accommodations_pkey" PRIMARY KEY ("rowId")
);

CREATE UNIQUE INDEX "cdm_accommodations_tenantId_idAvantio_key" ON "cdm_accommodations"("tenantId", "idAvantio");
CREATE INDEX "cdm_accommodations_tenantId_city_idx" ON "cdm_accommodations"("tenantId", "city");
CREATE INDEX "cdm_accommodations_tenantId_status_idx" ON "cdm_accommodations"("tenantId", "status");

ALTER TABLE "cdm_accommodations"
    ADD CONSTRAINT "cdm_accommodations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
