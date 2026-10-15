-- 14 Oct 2026 — Pricing Group list, corrected order and four new groups.
--
-- Highest → lowest:
--   LUX A, LUX B, LUX C, Grand A, Grand B, Grand C, Premium A, Premium B,
--   Premium C, CKA, CKB, CKC, FINNPMB, FINNPMC, FINNCKA, FINNCKB
-- Grand now ranks ABOVE Premium (the first list had them the other way round).
-- Used by both Group RD Pricing (pricingGroup) and Group RD (groupRd).

-- 1. The list: new ranks, new values. Anything not named here is retired
--    (active = false: rows keep showing it, nobody can pick it).
UPDATE "dataset_picklist_values" SET "active" = false
WHERE "list" = 'accommodation.pricingGroup'
  AND "value" NOT IN ('LUX A', 'LUX B', 'LUX C', 'Grand A', 'Grand B', 'Grand C',
                      'Premium A', 'Premium B', 'Premium C', 'CKA', 'CKB', 'CKC',
                      'FINNPMB', 'FINNPMC', 'FINNCKA', 'FINNCKB');

INSERT INTO "dataset_picklist_values" ("id", "tenantId", "list", "value", "sortOrder", "active", "createdAt")
SELECT gen_random_uuid()::text, t."tenantId", 'accommodation.pricingGroup', v.value, v.rank, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'accommodation') t
CROSS JOIN (VALUES
  ('LUX A', 1), ('LUX B', 2), ('LUX C', 3),
  ('Grand A', 4), ('Grand B', 5), ('Grand C', 6),
  ('Premium A', 7), ('Premium B', 8), ('Premium C', 9),
  ('CKA', 10), ('CKB', 11), ('CKC', 12),
  ('FINNPMB', 13), ('FINNPMC', 14), ('FINNCKA', 15), ('FINNCKB', 16)
) AS v(value, rank)
ON CONFLICT ("tenantId", "list", "value") DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder", "active" = true;

-- 2. Moves already recorded were ranked against the wrong order (a Premium →
--    Grand move was called DOWN). Re-rank them once against the corrected
--    list. SET and CLEARED do not depend on the order and stay as they are.
--    From here on directions are frozen again when written.
UPDATE "pricing_group_moves" m SET
  "fromRank" = (SELECT p."sortOrder" FROM "dataset_picklist_values" p
                 WHERE p."tenantId" = m."tenantId" AND p."list" = 'accommodation.pricingGroup'
                   AND lower(regexp_replace(p."value", '\s+', '', 'g')) = lower(regexp_replace(coalesce(m."fromGroup", ''), '\s+', '', 'g'))
                 LIMIT 1),
  "toRank"   = (SELECT p."sortOrder" FROM "dataset_picklist_values" p
                 WHERE p."tenantId" = m."tenantId" AND p."list" = 'accommodation.pricingGroup'
                   AND lower(regexp_replace(p."value", '\s+', '', 'g')) = lower(regexp_replace(coalesce(m."toGroup", ''), '\s+', '', 'g'))
                 LIMIT 1);

UPDATE "pricing_group_moves" SET "direction" = CASE
    WHEN "fromRank" IS NULL OR "toRank" IS NULL THEN 'UNRANKED'
    WHEN "toRank" < "fromRank" THEN 'UP'
    WHEN "toRank" > "fromRank" THEN 'DOWN'
    ELSE 'SAME'
  END
WHERE "direction" NOT IN ('SET', 'CLEARED');
