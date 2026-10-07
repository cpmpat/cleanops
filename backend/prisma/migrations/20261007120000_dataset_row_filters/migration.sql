-- Row filters: which RECORDS of a CDM list a role sees, on top of the access
-- matrix (which COLUMNS). A role with no filter on a list sees every row; with
-- filters, a row must pass all of them (AND). Each filter: the field's value
-- is one of `values` (exact match).
--
-- First use, 7 Oct 2026 — TERENAK sees Accommodation rows from Avantio only
-- and User rows that are Valid only.

CREATE TABLE "dataset_row_filters" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "dataset"   TEXT NOT NULL,
    "role"      "UserRole" NOT NULL,
    "field"     TEXT NOT NULL,
    "values"    TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dataset_row_filters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dataset_row_filters_tenantId_dataset_role_field_key"
    ON "dataset_row_filters"("tenantId", "dataset", "role", "field");
ALTER TABLE "dataset_row_filters"
    ADD CONSTRAINT "dataset_row_filters_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "dataset_row_filters" ("id", "tenantId", "dataset", "role", "field", "values", "updatedAt")
SELECT gen_random_uuid()::text, t."tenantId", v.dataset, 'TERENAK'::"UserRole", v.field, v.vals, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" FROM "dataset_fields") t
CROSS JOIN (VALUES
  ('accommodation', 'source',   ARRAY['Avantio']),
  ('user',          'validity', ARRAY['Valid'])
) AS v(dataset, field, vals)
ON CONFLICT DO NOTHING;
