import { decryptField, encryptField, isEncrypted, maskIdNumber } from './field-crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');

describe('field-crypto', () => {
  const saved = { k: process.env.FIELD_ENCRYPTION_KEY, n: process.env.NODE_ENV };
  beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = KEY; process.env.NODE_ENV = 'test'; });
  afterAll(() => {
    if (saved.k === undefined) delete process.env.FIELD_ENCRYPTION_KEY; else process.env.FIELD_ENCRYPTION_KEY = saved.k;
    process.env.NODE_ENV = saved.n;
  });

  it('round-trips and never stores the plaintext', () => {
    const enc = encryptField('42101-1234567-3');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('42101');
    expect(decryptField(enc)).toBe('42101-1234567-3');
  });
  it('uses a fresh IV each time (same input, different ciphertext)', () => {
    expect(encryptField('x')).not.toBe(encryptField('x'));
  });
  it('detects tampering', () => {
    const [p, iv, tag, ct] = encryptField('secret-id').split(':');
    const flipped = Buffer.from(ct, 'base64url'); flipped[0] ^= 1;
    expect(() => decryptField([p, iv, tag, flipped.toString('base64url')].join(':'))).toThrow();
  });
  it('refuses a shortened authentication tag (GCM must use the full 16 bytes)', () => {
    const [p, iv, tag, ct] = encryptField('secret-id').split(':');
    const short = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => decryptField([p, iv, short, ct].join(':'))).toThrow();
  });
  it('fails with the wrong key', () => {
    const enc = encryptField('abc');
    process.env.FIELD_ENCRYPTION_KEY = OTHER;
    expect(() => decryptField(enc)).toThrow();
  });
  it('treats un-prefixed legacy values as plaintext (until the backfill runs)', () => {
    expect(isEncrypted('42101-1234567-3')).toBe(false);
    expect(decryptField('42101-1234567-3')).toBe('42101-1234567-3');
  });
  it('rejects a key that is not 32 bytes, and requires a key in production', () => {
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptField('x')).toThrow(/32 bytes/);
    delete process.env.FIELD_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => encryptField('x')).toThrow(/required in production/);
  });
  describe('maskIdNumber', () => {
    it('masks a CNIC as 42101-*******-3, from plaintext or ciphertext', () => {
      expect(maskIdNumber('42101-1234567-3')).toBe('42101-*******-3');
      expect(maskIdNumber('4210112345673')).toBe('42101-*******-3');
      expect(maskIdNumber(encryptField('42101-1234567-3'))).toBe('42101-*******-3');
    });
    it('masks anything else generically and never throws on garbage ciphertext', () => {
      expect(maskIdNumber('AB12345')).toBe('*****5');
      expect(maskIdNumber('ab')).toBe('***');
      expect(maskIdNumber('v1:bad:bad:bad')).toBe('***');
      expect(maskIdNumber(null)).toBeNull();
    });
  });
});
