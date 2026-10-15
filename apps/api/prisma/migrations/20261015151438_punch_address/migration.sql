-- AlterTable
ALTER TABLE "AttendancePunch" ADD COLUMN     "address" TEXT,
ADD COLUMN     "addressSource" TEXT;

-- CreateTable
CREATE TABLE "GeocodeCache" (
    "key" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("key")
);
