-- Four more roles, and the first two CDM tables.
--
-- The enum values are added but never USED in this migration. Postgres allows
-- ALTER TYPE ... ADD VALUE inside a transaction, but not using the new value in
-- that same transaction, so any seeding of these roles has to be a separate step.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DIRECTOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'EVIDENCE';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RESOLUTIONS';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MARKETING_MANAGER';

ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'DATA_EDIT';

-- ─── dataset_fields ────────────────────────────────────────────────────────
-- Replaces the mapping<Tab> sheet lookup, the hardcoded HIDDEN_BY_DEFAULT
-- array, and column order by spreadsheet position.

CREATE TABLE "dataset_fields" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "dataset"         TEXT NOT NULL,
    "columnOrder"     INTEGER NOT NULL,
    "field"           TEXT NOT NULL,
    "displayName"     TEXT NOT NULL,
    "description"     TEXT,
    "type"            TEXT NOT NULL DEFAULT 'text',
    "hiddenByDefault" BOOLEAN NOT NULL DEFAULT false,
    "sensitive"       BOOLEAN NOT NULL DEFAULT false,
    "required"        BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dataset_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dataset_fields_tenantId_dataset_field_key"
    ON "dataset_fields"("tenantId", "dataset", "field");
CREATE INDEX "dataset_fields_tenantId_dataset_columnOrder_idx"
    ON "dataset_fields"("tenantId", "dataset", "columnOrder");

ALTER TABLE "dataset_fields"
    ADD CONSTRAINT "dataset_fields_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── cdm_users ─────────────────────────────────────────────────────────────
-- Column names mirror the sheet header exactly, typos included. `not` needs
-- quoting because it is a reserved word; every identifier here is quoted anyway.

CREATE TABLE "cdm_users" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "internalId"            TEXT NOT NULL,
    "firstName"             TEXT,
    "lastName"              TEXT,
    "position"              TEXT,
    "area"                  TEXT,
    "dataAccess"            INTEGER,
    "department"            TEXT,
    "possitionTier"         TEXT,
    "role"                  TEXT,
    "email1"                TEXT,
    "email2"                TEXT,
    "passwordEmail1"        TEXT,
    "passwordEmail2Avantio" TEXT,
    "phuneNumber"           TEXT,
    "validity"              TEXT,
    "cleaningArea"          TEXT,
    "checkinCollaborator"   BOOLEAN,
    "rajon"                 TEXT,
    "nickname"              TEXT,
    "not"                   TEXT,
    "address"               TEXT,
    "birthNumber"           TEXT,
    "birthPlace"            TEXT,
    "businessId"            TEXT,
    "healthInsurer"         TEXT,
    "tariff"                TEXT,
    "terminationDate"       TIMESTAMP(3),
    "startDate"             TIMESTAMP(3),
    "folder"                TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cdm_users_pkey" PRIMARY KEY ("id")
);

-- internalId is unique across all 122 source rows. email1 is NOT: two pairs of
-- people share a mailbox in the source data, so it can never be a key here.
CREATE UNIQUE INDEX "cdm_users_tenantId_internalId_key"
    ON "cdm_users"("tenantId", "internalId");
CREATE INDEX "cdm_users_tenantId_lastName_idx"
    ON "cdm_users"("tenantId", "lastName");

ALTER TABLE "cdm_users"
    ADD CONSTRAINT "cdm_users_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
