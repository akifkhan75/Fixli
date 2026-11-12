-- R2 money path (doc 27): schema changes + invariants Prisma cannot express.
-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "metadata" JSONB,
ALTER COLUMN "currency" DROP DEFAULT;
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "autoConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "claimedAmount" INTEGER,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "reminderStage" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "currency" DROP DEFAULT;
-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- One live cash payment per job: repeat "mark cash" calls cannot create a second one.
CREATE UNIQUE INDEX "Payment_one_live_per_job"
  ON "Payment" ("jobRequestId")
  WHERE "status" IN ('MARKED_BY_WORKER', 'CONFIRMED', 'DISPUTED');

-- The ledger is append-only: balances derive from entries, so entries can never change.
CREATE OR REPLACE FUNCTION "ledger_entry_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only (% not allowed)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_immutable"();
