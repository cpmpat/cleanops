-- 15 Oct 2026 — accommodation.oxPointId holds the OX Point's four-character
-- code (cdm_ox_point.id, e.g. ITS4), not its "ID" column (oxId): the first
-- refresh matched none of the 42 by oxId. The pick list reads codes now.
UPDATE "dataset_fields" SET "picklist" = 'ref:oxpoint.id'
WHERE "dataset" = 'accommodation' AND "field" = 'oxPointId';
