-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'OPEN', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectWorkType" AS ENUM ('NEW_BUILD', 'RENOVATION', 'INSTALLATION', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ProjectPropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'SHOP', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectPaymentMode" AS ENUM ('ESCROW', 'DIRECT');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'RELEASED', 'DISPUTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "milestoneId" TEXT,
ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "jobRequestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "jobRequestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "teamSize" INTEGER;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "workType" "ProjectWorkType" NOT NULL,
    "propertyType" "ProjectPropertyType" NOT NULL DEFAULT 'HOUSE',
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentMode" "ProjectPaymentMode" NOT NULL DEFAULT 'DIRECT',
    "addressId" TEXT,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "area" TEXT,
    "city" TEXT,
    "budgetMin" INTEGER,
    "budgetMax" INTEGER,
    "currency" TEXT NOT NULL,
    "startWhen" TEXT NOT NULL DEFAULT 'ASAP',
    "suggestedMilestones" JSONB,
    "audioKey" TEXT,
    "audioTranscript" TEXT,
    "photoKeys" TEXT[],
    "awardedWorkerId" TEXT,
    "awardedBidId" TEXT,
    "agreedAmount" INTEGER,
    "idempotencyKey" TEXT,
    "publishedAt" TIMESTAMP(3),
    "awardedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvite" (
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvite_pkey" PRIMARY KEY ("projectId","workerId")
);

-- CreateTable
CREATE TABLE "ProjectBid" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "note" TEXT,
    "milestones" JSONB NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceKeys" TEXT[],
    "submittedNote" TEXT,
    "changesNote" TEXT,
    "fundedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPayment" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "commission" INTEGER,
    "provider" TEXT,
    "providerRef" TEXT,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMaterial" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "providedBy" TEXT NOT NULL,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectVisit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_customerId_createdAt_idx" ON "Project"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_status_categoryId_idx" ON "Project"("status", "categoryId");

-- CreateIndex
CREATE INDEX "Project_awardedWorkerId_status_idx" ON "Project"("awardedWorkerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_customerId_idempotencyKey_key" ON "Project"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectInvite_workerId_createdAt_idx" ON "ProjectInvite"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectBid_projectId_status_idx" ON "ProjectBid"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectBid_workerId_status_idx" ON "ProjectBid"("workerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBid_projectId_workerId_key" ON "ProjectBid"("projectId", "workerId");

-- CreateIndex
CREATE INDEX "ProjectMilestone_status_submittedAt_idx" ON "ProjectMilestone"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "ProjectMilestone_status_approvedAt_idx" ON "ProjectMilestone"("status", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_projectId_position_key" ON "ProjectMilestone"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPayment_providerRef_key" ON "ProjectPayment"("providerRef");

-- CreateIndex
CREATE INDEX "ProjectPayment_milestoneId_status_idx" ON "ProjectPayment"("milestoneId", "status");

-- CreateIndex
CREATE INDEX "ProjectPayment_status_releasedAt_idx" ON "ProjectPayment"("status", "releasedAt");

-- CreateIndex
CREATE INDEX "ProjectMaterial_projectId_idx" ON "ProjectMaterial"("projectId");

-- CreateIndex
CREATE INDEX "ProjectVisit_projectId_scheduledAt_idx" ON "ProjectVisit"("projectId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Conversation_projectId_idx" ON "Conversation"("projectId");

-- CreateIndex
CREATE INDEX "Dispute_projectId_idx" ON "Dispute"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_projectId_reviewerId_key" ON "Review"("projectId", "reviewerId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_awardedWorkerId_fkey" FOREIGN KEY ("awardedWorkerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBid" ADD CONSTRAINT "ProjectBid_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBid" ADD CONSTRAINT "ProjectBid_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPayment" ADD CONSTRAINT "ProjectPayment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVisit" ADD CONSTRAINT "ProjectVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A review or dispute is about exactly one thing: a job or a project.
ALTER TABLE "Review" ADD CONSTRAINT "Review_one_subject" CHECK (num_nonnulls("jobRequestId", "projectId") = 1);
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_one_subject" CHECK (num_nonnulls("jobRequestId", "projectId") = 1);
