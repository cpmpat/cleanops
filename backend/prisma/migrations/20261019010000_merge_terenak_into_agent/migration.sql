-- 19 Oct 2026 — TERENAK is AGENT. One role, one name.
--
-- Everything TERENAK had moves to AGENT: its people, its Data matrix columns,
-- its Notifications → Data rows, its row filters and its column layouts. Where
-- AGENT already has a row for the same key, AGENT's row stays and the TERENAK
-- one is dropped (nothing is overwritten). Then the TERENAK value is removed
-- from the "UserRole" enum, which Postgres only allows by building the type
-- again — every column of that type is found from the catalog, so a table this
-- file does not know about is converted too instead of being left behind.
--
-- Sessions: a token minted with role TERENAK still works for up to 60 s (the
-- auth guard reads the role from the database) and the app swaps it for a
-- current one on the next screen load (ensureSessionMatchesRole).

-- 1. Keys that would collide once TERENAK becomes AGENT.
DELETE FROM "dataset_field_access" t USING "dataset_field_access" a
WHERE t."role" = 'TERENAK' AND a."role" = 'AGENT'
  AND a."tenantId" = t."tenantId" AND a."dataset" = t."dataset" AND a."field" = t."field";

DELETE FROM "dataset_field_notify" t USING "dataset_field_notify" a
WHERE t."role" = 'TERENAK' AND a."role" = 'AGENT'
  AND a."tenantId" = t."tenantId" AND a."dataset" = t."dataset" AND a."field" = t."field";

DELETE FROM "dataset_row_filters" t USING "dataset_row_filters" a
WHERE t."role" = 'TERENAK' AND a."role" = 'AGENT'
  AND a."tenantId" = t."tenantId" AND a."dataset" = t."dataset" AND a."field" = t."field";

DELETE FROM "dataset_field_roles" t USING "dataset_field_roles" a
WHERE t."role" = 'TERENAK' AND a."role" = 'AGENT' AND a."fieldId" = t."fieldId";

-- 2. TERENAK → AGENT in every column of the enum.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.udt_name = 'UserRole'
  LOOP
    EXECUTE format('UPDATE %I SET %I = %L WHERE %I = %L',
                   r.table_name, r.column_name, 'AGENT', r.column_name, 'TERENAK');
  END LOOP;
END $$;

-- 3. Build the enum again without TERENAK (order as in schema.prisma).
ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'MANAGER', 'CLEANER', 'REPAIRMAN', 'ADMIN', 'OPERATION_MANAGER', 'FRONT_DESK_MANAGER',
  'FRONT_DESK', 'ASSIST', 'AGENT', 'DIRECTOR', 'EVIDENCE', 'RESOLUTIONS', 'MARKETING_MANAGER',
  'FINANCE', 'REVENUE_MANAGER', 'MARKETING_SPECIALIST', 'OPERATIONS_ASSISTANT'
);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = current_schema() AND c.udt_name = 'UserRole_old'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE "UserRole" USING (%I::text::"UserRole")',
                   r.table_name, r.column_name, r.column_name);
  END LOOP;
END $$;

DROP TYPE "UserRole_old";
