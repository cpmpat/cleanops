-- 15 Oct 2026 — two roles. Values only; their use is in the next migration
-- (a new enum value cannot be used in the transaction that adds it).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MARKETING_SPECIALIST';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_ASSISTANT';
