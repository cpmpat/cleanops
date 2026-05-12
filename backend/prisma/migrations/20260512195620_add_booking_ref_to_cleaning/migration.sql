/*
  Warnings:

  - Added the required column `bookingRef` to the `cleanings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "cleanings" ADD COLUMN     "bookingRef" TEXT NOT NULL;
