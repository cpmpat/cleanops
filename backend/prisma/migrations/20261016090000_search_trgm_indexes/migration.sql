-- 16 Oct 2026 — the top-bar search (Shift+S) looks for a fragment anywhere in
-- one column per list (Prisma `contains` + insensitive = ILIKE '%q%'). A plain
-- B-tree index cannot serve a leading wildcard; a trigram GIN index can, and
-- it serves ILIKE too. pg_trgm ships with Neon.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "cdm_accommodations_titleAvantio_trgm_idx"
  ON "cdm_accommodations" USING GIN ("titleAvantio" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "cdm_owners_displayName_trgm_idx"
  ON "cdm_owners" USING GIN ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "cdm_ox_point_street_trgm_idx"
  ON "cdm_ox_point" USING GIN ("street" gin_trgm_ops);
