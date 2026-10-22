-- Guest phones entered by the desk, in international form "+<digits>" (22 Oct 2026).
-- Avantio's numbers are normalised when read (common/phone.ts); this brings the
-- ones already stored in line: "00420…" → "+420…", "420…" → "+420…", spaces gone.
UPDATE "bookings"
SET "guestPhone" = '+' || CASE
    WHEN regexp_replace("guestPhone", '\D', '', 'g') LIKE '00%' AND left(btrim("guestPhone"), 1) <> '+'
      THEN substr(regexp_replace("guestPhone", '\D', '', 'g'), 3)
    ELSE regexp_replace("guestPhone", '\D', '', 'g')
  END
WHERE "guestPhone" IS NOT NULL
  AND regexp_replace("guestPhone", '\D', '', 'g') <> ''
  AND "guestPhone" !~ '^\+\d+$';
