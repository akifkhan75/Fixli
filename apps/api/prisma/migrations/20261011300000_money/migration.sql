-- F3 money (doc 27): country money rules, one cash payment per job, an exact commission ledger.

-- Country money rules. New columns get the Pakistan O8 placeholders as defaults for any existing
-- row, then the defaults are dropped so every new country must state its own rules.
ALTER TABLE "CountryConfig"
  ADD COLUMN "commission" JSONB NOT NULL DEFAULT '{"rateBps":1200,"minMinor":10000,"maxMinor":150000}',
  ADD COLUMN "cashLimits" JSONB NOT NULL DEFAULT '{"softMinor":300000,"hardMinor":500000,"maxDaysOwed":7}',
  ADD COLUMN "settlementRails" JSONB NOT NULL DEFAULT '[{"id":"JAZZCASH","label":"JazzCash","account":null},{"id":"EASYPAISA","label":"Easypaisa","account":null},{"id":"BANK","label":"Bank transfer","account":null}]',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CountryConfig" ALTER COLUMN "commission" DROP DEFAULT, ALTER COLUMN "cashLimits" DROP DEFAULT, ALTER COLUMN "settlementRails" DROP DEFAULT;

INSERT INTO "CountryConfig" ("id", "countryCode", "currency", "emergencyNumbers", "commission", "cashLimits", "settlementRails", "version", "createdAt", "updatedAt")
VALUES (
  'cc_pk', 'PK', 'PKR',
  '[{"label":"Police","number":"15"},{"label":"Rescue","number":"1122"}]',
  '{"rateBps":1200,"minMinor":10000,"maxMinor":150000}',
  '{"softMinor":300000,"hardMinor":500000,"maxDaysOwed":7}',
  '[{"id":"JAZZCASH","label":"JazzCash","account":null},{"id":"EASYPAISA","label":"Easypaisa","account":null},{"id":"BANK","label":"Bank transfer","account":null}]',
  1, now(), now()
) ON CONFLICT ("countryCode") DO NOTHING;

ALTER TABLE "Dispute" ADD COLUMN "paymentId" TEXT;

ALTER TABLE "LedgerEntry" ADD COLUMN "idempotencyKey" TEXT, ADD COLUMN "note" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN "autoConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "markedAt" TIMESTAMP(3),
  ADD COLUMN "markedById" TEXT;

ALTER TABLE "Settlement" ADD COLUMN "note" TEXT, ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewedById" TEXT;

ALTER TABLE "Worker"
  ADD COLUMN "balanceBlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ledgerBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "owedSince" TIMESTAMP(3);

-- Existing payments: best-known timestamps.
UPDATE "Payment" SET "markedAt" = "createdAt" WHERE "markedAt" IS NULL AND "status" IN ('MARKED_BY_WORKER', 'CONFIRMED', 'DISPUTED');
UPDATE "Payment" SET "confirmedAt" = "updatedAt" WHERE "confirmedAt" IS NULL AND "status" = 'CONFIRMED';

-- One cash payment per job. The old code allowed duplicates (doc 26 9.2): keep the confirmed one
-- (else the earliest), drop the rest.
DELETE FROM "Payment" p USING (
  SELECT id, row_number() OVER (PARTITION BY "jobRequestId", "method" ORDER BY ("status" = 'CONFIRMED') DESC, "createdAt", id) AS rn FROM "Payment"
) d WHERE p.id = d.id AND d.rn > 1;

-- The old ledger stored debt as negative numbers; the new convention is + = more owed.
UPDATE "LedgerEntry" SET "amount" = -"amount", "balanceAfter" = -"balanceAfter";

-- Commission is booked once per job: the earliest entry per job gets the key; any later duplicate
-- (from the old double-confirm race) is reversed with an explicit adjustment so history stays honest.
UPDATE "LedgerEntry" e SET "idempotencyKey" = 'commission:' || e."jobRequestId"
FROM (
  SELECT id, row_number() OVER (PARTITION BY "jobRequestId" ORDER BY "createdAt", id) AS rn
  FROM "LedgerEntry" WHERE "type" = 'COMMISSION_OWED' AND "jobRequestId" IS NOT NULL
) d WHERE e.id = d.id AND d.rn = 1;
INSERT INTO "LedgerEntry" ("id", "workerId", "jobRequestId", "type", "amount", "currency", "balanceAfter", "idempotencyKey", "note", "createdAt")
SELECT 'le_fix_' || e.id, e."workerId", e."jobRequestId", 'ADJUSTMENT', -e."amount", e."currency", 0, 'duplicate-reversal:' || e.id,
       'Reverses a duplicate commission charge (migration 20261011300000)', now()
FROM "LedgerEntry" e
WHERE e."type" = 'COMMISSION_OWED' AND e."jobRequestId" IS NOT NULL AND e."idempotencyKey" IS NULL;

-- Recompute each worker's balance from the corrected ledger, and running balances in order.
WITH running AS (
  SELECT id, SUM("amount") OVER (PARTITION BY "workerId" ORDER BY "createdAt", id) AS bal FROM "LedgerEntry"
)
UPDATE "LedgerEntry" e SET "balanceAfter" = r.bal FROM running r WHERE e.id = r.id;
UPDATE "Worker" w SET "ledgerBalance" = COALESCE((SELECT SUM("amount") FROM "LedgerEntry" e WHERE e."workerId" = w.id), 0);
UPDATE "Worker" w SET "owedSince" = (SELECT MIN("createdAt") FROM "LedgerEntry" e WHERE e."workerId" = w.id) WHERE w."ledgerBalance" > 0;

CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX "LedgerEntry_workerId_createdAt_idx" ON "LedgerEntry"("workerId", "createdAt");
CREATE UNIQUE INDEX "Payment_jobRequestId_method_key" ON "Payment"("jobRequestId", "method");
CREATE INDEX "Settlement_status_createdAt_idx" ON "Settlement"("status", "createdAt");
