-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "systemKey" TEXT,
ADD COLUMN     "systemParams" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpRecoveryHashes" TEXT[];


-- Nothing wrote totpSecret before this change; clear any stray value so only sealed secrets exist.
UPDATE "User" SET "totpSecret" = NULL WHERE "totpEnabledAt" IS NULL;

-- Give existing server-written messages their template key (text stays as the English fallback).
UPDATE "Message" SET "systemKey" = 'job.started' WHERE "isSystem" AND "text" = 'The professional has started the work.';
UPDATE "Message" SET "systemKey" = 'job.completed' WHERE "isSystem" AND "text" = 'The professional has marked the work as completed.';
UPDATE "Message" SET "systemKey" = 'job.en_route' WHERE "isSystem" AND "text" = 'The professional is on the way.';
UPDATE "Message" SET "systemKey" = 'chat.contact_warning' WHERE "isSystem" AND "text" LIKE 'Please keep communication on Fixli.%';
