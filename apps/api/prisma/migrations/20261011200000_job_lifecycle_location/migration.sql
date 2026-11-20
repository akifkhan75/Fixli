-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "previousPrice" INTEGER;

-- AlterTable
ALTER TABLE "JobRequest" ADD COLUMN     "autoConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobLocationPoint" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobLocationPoint_jobRequestId_at_idx" ON "JobLocationPoint"("jobRequestId", "at");

-- CreateIndex
CREATE INDEX "JobLocationPoint_at_idx" ON "JobLocationPoint"("at");

-- AddForeignKey
ALTER TABLE "JobLocationPoint" ADD CONSTRAINT "JobLocationPoint_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Jobs already waiting for confirmation start their auto-confirm clock from their last update.
UPDATE "JobRequest" SET "finishedAt" = "updatedAt" WHERE "status" = 'AWAITING_CONFIRMATION' AND "finishedAt" IS NULL;
UPDATE "JobRequest" SET "completedAt" = "updatedAt" WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;
