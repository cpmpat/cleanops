-- One more role. Same reasoning as the previous six: a value, no permissions
-- yet, but immediately usable as an audience and as a chat participant.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OPERATION_MANAGER';
