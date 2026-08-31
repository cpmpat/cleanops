-- feeAdmin goes back to being a number.
--
-- The previous migration widened it to text because one cell held "x". That
-- cell was a typo, not a marker, and has been corrected at source — so the
-- column really is numeric, and saying so is worth more than a column that
-- accepts anything.
--
-- Rolled forward rather than by deleting 20260901020000: that migration may
-- already be applied somewhere, and removing an applied migration is how a
-- Prisma history goes into drift.
--
-- The cast assumes no non-numeric text survives. The table is empty, and the
-- import that fills it now refuses any value this column could not hold, so
-- there is nothing to convert.

ALTER TABLE "cdm_accommodations"
    ALTER COLUMN "feeAdmin" TYPE INTEGER
    USING NULLIF(btrim("feeAdmin"), '')::INTEGER;
