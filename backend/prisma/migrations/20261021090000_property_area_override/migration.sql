-- A hand-set area for a unit whose name says another place (21 Oct 2026).
-- The accommodation sync copies it into "area" instead of reading the name.
ALTER TABLE "properties" ADD COLUMN "areaOverride" TEXT;
