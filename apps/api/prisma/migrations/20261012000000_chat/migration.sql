-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isFlagged" BOOLEAN NOT NULL DEFAULT false;


-- Chats already closed: best-known closing time.
UPDATE "Conversation" SET "closedAt" = "updatedAt" WHERE "isReadOnly" AND "closedAt" IS NULL;
-- Blocking used to freeze the chat instead of applying everywhere; unfreeze those (the block
-- itself now stops messages, matching and prices) unless the chat closed for its own reasons.
UPDATE "Conversation" c SET "isReadOnly" = false, "closedAt" = NULL
WHERE c."isReadOnly" AND EXISTS (SELECT 1 FROM "Block" b WHERE b."conversationId" = c.id)
  AND NOT EXISTS (SELECT 1 FROM "JobRequest" j WHERE j.id = c."jobRequestId" AND j.status IN ('COMPLETED', 'CANCELLED'));
