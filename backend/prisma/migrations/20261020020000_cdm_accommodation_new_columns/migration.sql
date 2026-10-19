-- 20 Oct 2026: six new columns in the Accommodation sheet, and ownerVatPayer
-- becomes text (the sheet now names the VAT status instead of TRUE/FALSE).
ALTER TABLE "cdm_accommodations" ALTER COLUMN "ownerVatPayer" TYPE TEXT USING "ownerVatPayer"::text;

ALTER TABLE "cdm_accommodations" ADD COLUMN IF NOT EXISTS "contractType" TEXT;
ALTER TABLE "cdm_accommodations" ADD COLUMN IF NOT EXISTS "latitude" TEXT;
ALTER TABLE "cdm_accommodations" ADD COLUMN IF NOT EXISTS "longitude" TEXT;
ALTER TABLE "cdm_accommodations" ADD COLUMN IF NOT EXISTS "operatingEntity" TEXT;
ALTER TABLE "cdm_accommodations" ADD COLUMN IF NOT EXISTS "entranceCode" TEXT;
ALTER TABLE "cdm_accommodations" ADD COLUMN IF NOT EXISTS "lockPreparationCleaning" TEXT;
