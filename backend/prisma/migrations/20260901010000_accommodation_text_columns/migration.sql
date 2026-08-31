-- Four columns typed as numbers are not numbers.
--
-- The first dry run against the real 260 rows, rather than the ten-row sample:
--
--   feeExtraPerson   77 rows hold FALSE   — a fee, or FALSE meaning none
--   costChekin       11 rows hold FALSE   — same shape
--   feePms            1 row  holds "x"    — a manual marker
--   floor             3 rows hold "x" / "200%"
--
-- Storing them as integers would have written NULL over every one of those,
-- which is the quiet way to lose 92 real answers.
--
-- The table is still empty, so these are plain type changes with nothing to
-- convert. USING is spelled out anyway, so this migration does not depend on
-- the table being empty if it is ever replayed somewhere it is not.

ALTER TABLE "cdm_accommodations"
    ALTER COLUMN "feePms"         TYPE TEXT USING "feePms"::TEXT,
    ALTER COLUMN "feeExtraPerson" TYPE TEXT USING "feeExtraPerson"::TEXT,
    ALTER COLUMN "floor"          TYPE TEXT USING "floor"::TEXT,
    ALTER COLUMN "costChekin"     TYPE TEXT USING "costChekin"::TEXT;
