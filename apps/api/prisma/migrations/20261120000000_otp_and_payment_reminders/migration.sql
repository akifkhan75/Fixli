-- Phone verification codes (signup / password reset) and cash-payment reminder bookkeeping.
CREATE TABLE "PhoneVerification" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    CONSTRAINT "PhoneVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PhoneVerification_phone_purpose_createdAt_idx" ON "PhoneVerification"("phone", "purpose", "createdAt");

ALTER TABLE "Payment" ADD COLUMN "claimedAmount" INTEGER, ADD COLUMN "reminderStage" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Incident" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
