-- 18 Oct 2026 — Accommodation pick lists, as Patrik set them:
--   status                Valid, Invalid
--   cotractType           Servicing, Operating      ("Contract type"; the column
--                                                    keeps the sheet's spelling)
--   salesRentalDivision   Short-term, Mid-term
--   checkInMethod         TTLock, vítej.box/Nuki/Lockbox, Nuki, OX Point,
--                         Lockbox, vítej.box/Nuki, BCBox/Nuki
--                         ("Reception" and "WLNKA", one unit each, are one-offs:
--                         left on their rows, not added to the list)
--   accommodationStandard Comfort, Lux, Basic, Airstay
--
-- Each list becomes exactly these values, in this order: they are added (or
-- re-activated) and every other value of the list is deactivated, not deleted.
-- An inactive value stays readable on the rows that hold it but can no longer
-- be picked. Existing data that differs from a new value only in case, spaces,
-- hyphens or the accent on "vítej" is rewritten to the list's spelling; any
-- other value is left as it is (see `diag:dataset-values`).

-- No temporary tables or functions: the list is written out in each statement
-- so the migration runs the same through a pooled connection.

-- 1. Bind the five columns to their lists (status, checkInMethod and
--    accommodationStandard already are; this is idempotent).
UPDATE "dataset_fields" SET "picklist" = 'accommodation.' || "field"
WHERE "dataset" = 'accommodation'
  AND "field" IN ('status', 'cotractType', 'salesRentalDivision', 'checkInMethod', 'accommodationStandard');

-- 2. The values, per tenant that has the Accommodation list.
INSERT INTO "dataset_picklist_values" ("id", "tenantId", "list", "value", "sortOrder", "active", "createdAt")
SELECT gen_random_uuid()::text, t."tenantId", 'accommodation.' || p."field", p."value", p."ord", true, now()
FROM (SELECT DISTINCT "tenantId" FROM "dataset_fields" WHERE "dataset" = 'accommodation') t
CROSS JOIN (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
ON CONFLICT ("tenantId", "list", "value")
DO UPDATE SET "active" = true, "sortOrder" = EXCLUDED."sortOrder";

-- 3. Everything else on these five lists: inactive (kept, not deleted).
UPDATE "dataset_picklist_values" v SET "active" = false
WHERE v."list" IN ('accommodation.status', 'accommodation.cotractType', 'accommodation.salesRentalDivision',
                   'accommodation.checkInMethod', 'accommodation.accommodationStandard')
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
    WHERE 'accommodation.' || p."field" = v."list" AND p."value" = v."value"
  );

-- 4. Same value, different spelling → the list's spelling. The match ignores
--    case, spaces, hyphens, underscores and the accent on "í".
UPDATE "cdm_accommodations" a SET "status" = p."value"
FROM (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
WHERE p."field" = 'status' AND a."status" IS DISTINCT FROM p."value"
  AND lower(regexp_replace(translate(coalesce(a."status", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g')) = lower(regexp_replace(translate(coalesce(p."value", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g'));

UPDATE "cdm_accommodations" a SET "cotractType" = p."value"
FROM (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
WHERE p."field" = 'cotractType' AND a."cotractType" IS DISTINCT FROM p."value"
  AND lower(regexp_replace(translate(coalesce(a."cotractType", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g')) = lower(regexp_replace(translate(coalesce(p."value", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g'));

UPDATE "cdm_accommodations" a SET "salesRentalDivision" = p."value"
FROM (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
WHERE p."field" = 'salesRentalDivision' AND a."salesRentalDivision" IS DISTINCT FROM p."value"
  AND lower(regexp_replace(translate(coalesce(a."salesRentalDivision", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g')) = lower(regexp_replace(translate(coalesce(p."value", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g'));

UPDATE "cdm_accommodations" a SET "checkInMethod" = p."value"
FROM (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
WHERE p."field" = 'checkInMethod' AND a."checkInMethod" IS DISTINCT FROM p."value"
  AND lower(regexp_replace(translate(coalesce(a."checkInMethod", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g')) = lower(regexp_replace(translate(coalesce(p."value", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g'));

UPDATE "cdm_accommodations" a SET "accommodationStandard" = p."value"
FROM (VALUES
  ('status', 'Valid', 1), ('status', 'Invalid', 2),
  ('cotractType', 'Servicing', 1), ('cotractType', 'Operating', 2),
  ('salesRentalDivision', 'Short-term', 1), ('salesRentalDivision', 'Mid-term', 2),
  ('checkInMethod', 'TTLock', 1), ('checkInMethod', 'vítej.box/Nuki/Lockbox', 2), ('checkInMethod', 'Nuki', 3),
  ('checkInMethod', 'OX Point', 4), ('checkInMethod', 'Lockbox', 5), ('checkInMethod', 'vítej.box/Nuki', 6),
  ('checkInMethod', 'BCBox/Nuki', 7),
  ('accommodationStandard', 'Comfort', 1), ('accommodationStandard', 'Lux', 2),
  ('accommodationStandard', 'Basic', 3), ('accommodationStandard', 'Airstay', 4)
) AS p("field", "value", "ord")
WHERE p."field" = 'accommodationStandard' AND a."accommodationStandard" IS DISTINCT FROM p."value"
  AND lower(regexp_replace(translate(coalesce(a."accommodationStandard", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g')) = lower(regexp_replace(translate(coalesce(p."value", ''), 'íÍ', 'iI'), '[[:space:]_-]', '', 'g'));
