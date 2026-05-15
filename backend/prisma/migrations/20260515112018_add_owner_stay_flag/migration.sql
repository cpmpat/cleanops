-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "isOwnerStay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "cleanings" ADD COLUMN     "isOwnerStay" BOOLEAN NOT NULL DEFAULT false;
