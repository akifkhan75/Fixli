import { randomBytes } from 'crypto';
import { rotateFieldKey } from '../../../prisma/rotate-field-key';
import { decryptField, encryptField, parseKey } from './field-crypto';

const newKey = () => randomBytes(32).toString('base64');

describe('rotateFieldKey', () => {
  const OLD = newKey();
  const NEW = newKey();
  const rows = new Map<string, string>();
  const prisma: any = {
    verificationCase: {
      findMany: jest.fn(async ({ cursor }: any) => {
        const all = [...rows.entries()].map(([id, reference]) => ({ id, reference })).sort((a, b) => a.id.localeCompare(b.id));
        const from = cursor ? all.findIndex((r) => r.id === cursor.id) + 1 : 0;
        return all.slice(from, from + 200);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (rows.get(where.id) !== where.reference) return { count: 0 };
        rows.set(where.id, data.reference); return { count: 1 };
      }),
    },
  };
  beforeEach(() => { rows.clear(); jest.clearAllMocks(); });

  it('a dry run changes nothing but reports what it would do', async () => {
    rows.set('a', encryptField('42101-1234567-3', parseKey(OLD)));
    const before = rows.get('a');
    await expect(rotateFieldKey(prisma, OLD, NEW, false)).resolves.toEqual({ rotated: 1, alreadyNew: 0, failed: [] });
    expect(rows.get('a')).toBe(before);
  });

  it('re-encrypts under the new key; the old key no longer opens it; repeating is a no-op', async () => {
    rows.set('a', encryptField('42101-1234567-3', parseKey(OLD)));
    rows.set('b', encryptField('35202-7654321-1', parseKey(OLD)));
    await expect(rotateFieldKey(prisma, OLD, NEW, true)).resolves.toMatchObject({ rotated: 2, failed: [] });
    expect(decryptField(rows.get('a')!, parseKey(NEW))).toBe('42101-1234567-3');
    expect(() => decryptField(rows.get('a')!, parseKey(OLD))).toThrow();
    await expect(rotateFieldKey(prisma, OLD, NEW, true)).resolves.toEqual({ rotated: 0, alreadyNew: 2, failed: [] });
  });

  it('reports rows it cannot open or that are still plaintext, and exits those untouched', async () => {
    rows.set('a', encryptField('1', parseKey(newKey())));   // some other key
    rows.set('b', '42101-1234567-3');                         // never encrypted
    const r = await rotateFieldKey(prisma, OLD, NEW, true);
    expect(r.rotated).toBe(0);
    expect(r.failed).toHaveLength(2);
    expect(r.failed.join(' ')).toMatch(/old key/);
    expect(r.failed.join(' ')).toMatch(/encrypt-ids/);
  });

  it('never overwrites a row that changed while it was running', async () => {
    rows.set('a', encryptField('x', parseKey(OLD)));
    prisma.verificationCase.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    const r = await rotateFieldKey(prisma, OLD, NEW, true);
    expect(r.rotated).toBe(0);
    expect(r.failed[0]).toMatch(/changed while rotating/);
  });

  it('refuses identical or malformed keys', async () => {
    await expect(rotateFieldKey(prisma, OLD, OLD, true)).rejects.toThrow(/same/);
    await expect(rotateFieldKey(prisma, 'short', NEW, true)).rejects.toThrow(/32 bytes/);
  });
});
