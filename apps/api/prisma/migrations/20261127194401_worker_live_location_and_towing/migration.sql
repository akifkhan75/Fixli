-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "canTow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currentLat" DOUBLE PRECISION,
ADD COLUMN     "currentLng" DOUBLE PRECISION,
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3);
