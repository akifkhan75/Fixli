-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpLastStep" INTEGER;

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentNote" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBand" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "issueCode" TEXT,
    "city" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "minMinor" INTEGER NOT NULL,
    "maxMinor" INTEGER NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryConfigVersion" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CountryConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterId_key" ON "ReviewReport"("reviewId", "reporterId");

-- CreateIndex
CREATE INDEX "IncidentNote_incidentId_createdAt_idx" ON "IncidentNote"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBand_categoryId_issueCode_city_key" ON "PriceBand"("categoryId", "issueCode", "city");

-- CreateIndex
CREATE UNIQUE INDEX "CountryConfigVersion_countryCode_version_key" ON "CountryConfigVersion"("countryCode", "version");

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBand" ADD CONSTRAINT "PriceBand_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing country rows start their version history at the current version.
INSERT INTO "CountryConfigVersion" ("id", "countryCode", "version", "data", "createdAt")
SELECT 'ccv_' || "countryCode" || '_' || "version", "countryCode", "version",
       jsonb_build_object('commission', "commission", 'cashLimits', "cashLimits", 'settlementRails', "settlementRails", 'emergencyNumbers', "emergencyNumbers"), now()
FROM "CountryConfig" ON CONFLICT DO NOTHING;
-- Reviews the new auto-rules would have flagged.
UPDATE "Review" SET "flagged" = true WHERE "status" = 'PUBLISHED' AND "rating" = 1 AND length(coalesce(trim("comment"), '')) < 10;
