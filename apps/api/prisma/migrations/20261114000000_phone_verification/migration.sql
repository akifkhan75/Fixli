-- R5 identity (doc 27): one-time phone codes.
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
-- At most one live (unconsumed) code per phone and purpose.
CREATE UNIQUE INDEX "PhoneVerification_live_key" ON "PhoneVerification"("phone", "purpose") WHERE "consumedAt" IS NULL;
