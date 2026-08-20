-- Six more roles on the UserRole enum.
--
-- Values only: nothing is wired to permissions yet. A role is two things in
-- this system — what a person may open, and who an announcement can be
-- addressed to — and the second one is useful before the first is decided.
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction (which is how
-- Prisma applies migrations) as long as the new value is not *used* in the same
-- transaction. Adding only, so this is safe. IF NOT EXISTS keeps the migration
-- re-runnable against a database where someone added a value by hand.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FRONT_DESK_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FRONT_DESK';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ASSIST';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'TERENAK';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AGENT';
