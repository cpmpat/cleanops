-- 15 Oct 2026 — the Accommodation sheet's OX Point block also has FX
-- "Oxpoint District" (oxpointDistrict), looked up from cdm_ox_point.district.
ALTER TABLE "cdm_accommodations" ADD COLUMN "oxpointDistrict" TEXT;
