-- AlterTable
ALTER TABLE "AttendancePunch" ADD COLUMN     "country" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "GeocodeCache" ADD COLUMN     "country" TEXT,
ADD COLUMN     "state" TEXT;

-- CreateIndex
CREATE INDEX "AttendancePunch_at_idx" ON "AttendancePunch"("at");
