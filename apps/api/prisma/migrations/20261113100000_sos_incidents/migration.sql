-- R3 SOS (doc 27): incident location + idempotency.
-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;
-- CreateIndex
CREATE UNIQUE INDEX "Incident_reporterId_idempotencyKey_key" ON "Incident"("reporterId", "idempotencyKey");
