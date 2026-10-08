-- 8 Oct 2026 — "Group RD" (groupRd) picks from the same ranked list as
-- "Group RD Pricing" (pricingGroup): accommodation.pricingGroup in
-- dataset_picklist_values. One list, so the two columns can never spell a
-- group differently.
UPDATE "dataset_fields" SET "picklist" = 'accommodation.pricingGroup'
WHERE "dataset" = 'accommodation' AND "field" = 'groupRd';
