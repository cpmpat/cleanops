-- Villas default to a 16:00 arrival when Avantio gives no time (29 Oct 2026).
-- The sync applies this from now on (common/checkin-default.ts); this moves the
-- future villa bookings already stored at the old 15:00 placeholder, and the live
-- turnovers whose deadline is that arrival.
--
-- Only FALLBACK times move: a time from the PMS or one the desk confirmed with
-- the guest (MANAGER) stays exactly as it is. The bookings stay FALLBACK, so the
-- desk still has to confirm them.
--
-- Columns are TIMESTAMP(3) without zone holding UTC, hence the double AT TIME ZONE.
-- +1 hour is safe on DST days: the switch happens at night, not at 15:00.

-- Turnovers first, while the bookings still read 15:00.
UPDATE "turnovers" t
SET "dueBy" = t."dueBy" + interval '1 hour'
FROM "bookings" b
JOIN "properties" p ON p."id" = b."propertyId"
WHERE t."toBookingId" = b."id"
  AND t."supersededById" IS NULL
  AND t."completedAt" IS NULL
  AND t."dueBy" = b."checkInTime"
  AND upper(btrim(p."accommodationType")) = 'VILLA'
  AND b."checkInSource" = 'FALLBACK'
  AND b."status" <> 'CANCELLED'
  AND b."checkInTime" > (now() AT TIME ZONE 'UTC')
  AND to_char((b."checkInTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague', 'HH24:MI') = '15:00';

UPDATE "bookings" b
SET "checkInTime" = b."checkInTime" + interval '1 hour'
FROM "properties" p
WHERE p."id" = b."propertyId"
  AND upper(btrim(p."accommodationType")) = 'VILLA'
  AND b."checkInSource" = 'FALLBACK'
  AND b."status" <> 'CANCELLED'
  AND b."checkInTime" > (now() AT TIME ZONE 'UTC')
  AND to_char((b."checkInTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague', 'HH24:MI') = '15:00';
