-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "contactsAlertStatus" TEXT,
ADD COLUMN     "contactsAlerted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "kind" TEXT;

-- CreateTable
CREATE TABLE "SosDispatch" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "incidentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFERING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "currentWorkerId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "triedWorkerIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SosDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SosDispatch_jobRequestId_key" ON "SosDispatch"("jobRequestId");

-- CreateIndex
CREATE INDEX "SosDispatch_status_expiresAt_idx" ON "SosDispatch"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_idempotencyKey_key" ON "Incident"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "SosDispatch" ADD CONSTRAINT "SosDispatch_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

