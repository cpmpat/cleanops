-- New office roles (7 Oct 2026). Values only; their screens and grants come
-- from the frontend menu and the access matrices. Kept in a migration of its
-- own: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'REVENUE_MANAGER';
