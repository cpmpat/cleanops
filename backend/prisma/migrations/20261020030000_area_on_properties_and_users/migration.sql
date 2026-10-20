-- 20 Oct 2026: areas. A unit's area comes from its Avantio name (the part after
-- the last " - ", district number dropped: "… - Praha 3" → "Praha"); the
-- accommodation sync keeps it current. A user's area limits what they see.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "area" TEXT;
CREATE INDEX IF NOT EXISTS "properties_tenantId_area_idx" ON "properties"("tenantId", "area");

UPDATE "properties"
   SET "area" = NULLIF(regexp_replace(btrim(substring("name" from ' - ([^-]+)$')), '\s*\d+$', ''), '')
 WHERE "area" IS NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "area" TEXT;

-- Everyone there today is Praha, except the manager (who sees every area).
UPDATE "users" SET "area" = 'Praha' WHERE "area" IS NULL AND "role" <> 'MANAGER';
