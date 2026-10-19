-- Guest phone entered by the front desk in Planning, pushed to Avantio (Oct 2026).
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestPhone" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestPhoneSetAt" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestPhoneSetById" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestPhonePushedAt" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guestPhonePushError" TEXT;
