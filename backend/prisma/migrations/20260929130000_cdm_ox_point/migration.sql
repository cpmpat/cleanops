-- CDM "OX Point" list, loaded from the sheet by import:cdm --list oxpoint.
-- All text until the data shows a type. No grants: nobody sees it in Data
-- until the access matrix says so (import:access-matrix).

CREATE TABLE "cdm_ox_point" (
    "rowId"      TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "id"         TEXT,
    "oxId" TEXT,
    "active" TEXT,
    "city" TEXT,
    "district" TEXT,
    "street" TEXT,
    "streetNumber" TEXT,
    "postCode" TEXT,
    "description" TEXT,
    "boxNumber" TEXT,
    "accessCode" TEXT,
    "lockBoxNumber" TEXT,
    "lockboxCode" TEXT,
    "accessibilityMonday" TEXT,
    "accessibilityTuesday" TEXT,
    "accessibilityWednesday" TEXT,
    "accessibilityThursday" TEXT,
    "accessibilityFriday" TEXT,
    "accessibilitySaturday" TEXT,
    "accessibilitySunday" TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
,
    CONSTRAINT "cdm_ox_point_pkey" PRIMARY KEY ("rowId")
);

CREATE UNIQUE INDEX "cdm_ox_point_tenantId_id_key" ON "cdm_ox_point"("tenantId", "id");
CREATE INDEX "cdm_ox_point_tenantId_city_idx" ON "cdm_ox_point"("tenantId", "city");

ALTER TABLE "cdm_ox_point"
    ADD CONSTRAINT "cdm_ox_point_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
