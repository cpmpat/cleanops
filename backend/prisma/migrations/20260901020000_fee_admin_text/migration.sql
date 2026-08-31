-- feeAdmin joins its siblings.
--
-- One cell holds "x". The same shape as feePms, floor, feeExtraPerson and
-- costChekin: the fee family is "a number, or a note about why there is not
-- one", and typing it as an integer writes NULL over the note.
--
-- One cell is not much. But it is one real answer, and the alternative is
-- asking someone to delete it from the sheet so the import stops complaining,
-- which is deleting data to satisfy a schema.

ALTER TABLE "cdm_accommodations"
    ALTER COLUMN "feeAdmin" TYPE TEXT USING "feeAdmin"::TEXT;
