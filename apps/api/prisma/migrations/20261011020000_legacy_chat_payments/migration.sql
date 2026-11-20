-- Move Phase 1-6 chat and payment rows into the new tables, then drop the old ones.
-- Written by hand: `prisma migrate diff` would drop the old tables without copying anything.

-- Chat threads -> conversations (same ids, so links keep working)
INSERT INTO "Conversation" ("id", "jobRequestId", "lastMessageAt", "isReadOnly", "createdAt", "updatedAt")
SELECT "id", "jobRequestId", "lastMessageAt", false, "createdAt", "updatedAt" FROM "ChatThread"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "_ConversationToUser" ("A", "B")
SELECT "A", "B" FROM "_ChatThreadToUser"
ON CONFLICT DO NOTHING;

-- The old model stored the receiver on each message; make sure both people are participants.
INSERT INTO "_ConversationToUser" ("A", "B")
SELECT DISTINCT m."threadId", u.uid FROM "ChatMessage" m
CROSS JOIN LATERAL (VALUES (m."senderId"), (m."receiverId")) AS u(uid)
ON CONFLICT DO NOTHING;

INSERT INTO "Message" ("id", "conversationId", "senderId", "text", "isSystem", "createdAt")
SELECT "id", "threadId", "senderId", "text", false, "createdAt" FROM "ChatMessage"
ON CONFLICT ("id") DO NOTHING;

-- isRead=true becomes a read receipt for the receiver
INSERT INTO "MessageRead" ("id", "messageId", "userId", "readAt")
SELECT 'mr_' || md5("id" || "receiverId"), "id", "receiverId", "createdAt" FROM "ChatMessage" WHERE "isRead" = true
ON CONFLICT DO NOTHING;

-- Card transactions -> payments
INSERT INTO "Payment" ("id", "jobRequestId", "method", "amount", "currency", "status", "provider", "providerRef", "createdAt", "updatedAt")
SELECT "id", "jobRequestId", 'CARD', "amount", "currency",
  CASE "status" WHEN 'COMPLETED' THEN 'CAPTURED' ELSE "status" END,
  CASE WHEN "stripeChargeId" IS NOT NULL THEN 'stripe' END, "stripeChargeId", "createdAt", "updatedAt"
FROM "Transaction"
ON CONFLICT ("id") DO NOTHING;

-- Reviews must now belong to a job. A review with no job can't be verified (doc 26 P0-2); remove them.
DELETE FROM "Review" WHERE "jobRequestId" IS NULL;
ALTER TABLE "Review" DROP CONSTRAINT "Review_jobRequestId_fkey";
ALTER TABLE "Review" ALTER COLUMN "jobRequestId" SET NOT NULL;
ALTER TABLE "Review" ADD CONSTRAINT "Review_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "JobRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop the old tables
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_receiverId_fkey";
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_senderId_fkey";
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_threadId_fkey";
ALTER TABLE "ChatThread" DROP CONSTRAINT "ChatThread_jobRequestId_fkey";
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_jobRequestId_fkey";
ALTER TABLE "_ChatThreadToUser" DROP CONSTRAINT "_ChatThreadToUser_A_fkey";
ALTER TABLE "_ChatThreadToUser" DROP CONSTRAINT "_ChatThreadToUser_B_fkey";
DROP TABLE "ChatMessage";
DROP TABLE "_ChatThreadToUser";
DROP TABLE "ChatThread";
DROP TABLE "Transaction";
