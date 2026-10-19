-- Repair: production's "AuditCategory" type had drifted from the migration
-- history and was missing ASSIGNMENT_LIFECYCLE (found 19 Oct 2026: assigning a
-- check-in agent failed with 22P02 "invalid input value for enum"). Re-add
-- every value the schema declares. IF NOT EXISTS makes each line a no-op where
-- the value is already present, so this is safe on any database.
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'CLEANING_LIFECYCLE';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_LIFECYCLE';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'AUTH';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'PMS_SYNC';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'INCIDENT_LIFECYCLE';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'SYSTEM';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'DATA_EDIT';
ALTER TYPE "AuditCategory" ADD VALUE IF NOT EXISTS 'AVAILABILITY_LIFECYCLE';
