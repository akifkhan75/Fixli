import { PrismaClient } from '@prisma/client';
import { decryptField, encryptField, isEncrypted, parseKey } from '../src/common/crypto/field-crypto';

/**
 * Re-encrypts identity numbers from an old FIELD_ENCRYPTION_KEY to a new one. Idempotent: a value
 * that already opens with the NEW key is left alone, so an interrupted run can simply be repeated.
 *
 *   OLD_FIELD_ENCRYPTION_KEY=... NEW_FIELD_ENCRYPTION_KEY=... pnpm --filter @fixli/api db:rotate-key           (dry run)
 *   OLD_FIELD_ENCRYPTION_KEY=... NEW_FIELD_ENCRYPTION_KEY=... pnpm --filter @fixli/api db:rotate-key -- --apply
 *
 * Order of operations: take a database backup, dry-run, apply, then set FIELD_ENCRYPTION_KEY to the
 * new key and redeploy straight away (until then the admin "reveal" cannot read rotated rows). Keep
 * the old key until you have revealed one case end-to-end with the new key.
 */
export interface RotationResult { rotated: number; alreadyNew: number; failed: string[] }

export async function rotateFieldKey(prisma: PrismaClient, oldKeyB64: string, newKeyB64: string, apply: boolean): Promise<RotationResult> {
  const oldKey = parseKey(oldKeyB64);
  const newKey = parseKey(newKeyB64);
  if (oldKey.equals(newKey)) throw new Error('The old and new keys are the same');
  const result: RotationResult = { rotated: 0, alreadyNew: 0, failed: [] };
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
      const stored = r.reference!;
      if (!isEncrypted(stored)) { result.failed.push(`${r.id}: not encrypted (run db:encrypt-ids first)`); continue; }
      try { decryptField(stored, newKey); result.alreadyNew++; continue; } catch { /* not under the new key yet */ }
      let plain: string;
      try { plain = decryptField(stored, oldKey); } catch { result.failed.push(`${r.id}: does not open with the old key`); continue; }
      const next = encryptField(plain, newKey);
      if (decryptField(next, newKey) !== plain) { result.failed.push(`${r.id}: round-trip check failed`); continue; }
      if (apply) {
        // Conditional on what we read, so a concurrent writer is never overwritten.
        const res = await prisma.verificationCase.updateMany({ where: { id: r.id, reference: stored }, data: { reference: next } });
        if (!res.count) { result.failed.push(`${r.id}: changed while rotating, run again`); continue; }
      }
      result.rotated++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return result;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  rotateFieldKey(prisma, process.env.OLD_FIELD_ENCRYPTION_KEY ?? '', process.env.NEW_FIELD_ENCRYPTION_KEY ?? '', apply)
    .then((r) => {
      console.log(`${apply ? 'Rotated' : 'Would rotate'}: ${r.rotated}, already on the new key: ${r.alreadyNew}, problems: ${r.failed.length}`);
      r.failed.forEach((f) => console.log(`  ! ${f}`));
      if (r.failed.length) process.exitCode = 1;
      if (!apply) console.log('Dry run only. Add --apply to write.');
    })
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
