import { PrismaClient } from '@prisma/client';
import { encryptField, isEncrypted } from '../src/common/crypto/field-crypto';

/**
 * One-off, idempotent backfill: encrypts identity numbers (VerificationCase.reference) that were
 * stored as plaintext before R4. Safe to re-run: already-encrypted values are skipped.
 *   FIELD_ENCRYPTION_KEY=... pnpm --filter @fixli/api db:encrypt-ids
 * Run once after deploying R4, BEFORE anyone is allowed to read the old rows directly.
 */
export async function encryptIdNumbers(prisma: PrismaClient): Promise<{ encrypted: number; skipped: number }> {
  let encrypted = 0;
  let skipped = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.verificationCase.findMany({
      where: { reference: { not: null } },
      select: { id: true, reference: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const r of rows) {
      if (!r.reference || isEncrypted(r.reference)) { skipped++; continue; }
      // Conditional on the old value so a concurrent writer can never be overwritten.
      const res = await prisma.verificationCase.updateMany({ where: { id: r.id, reference: r.reference }, data: { reference: encryptField(r.reference) } });
      if (res.count) encrypted++; else skipped++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { encrypted, skipped };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  encryptIdNumbers(prisma)
    .then((r) => console.log(`ID numbers encrypted: ${r.encrypted}, already encrypted/skipped: ${r.skipped}`))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
