import { base32Decode, base32Encode, generateRecoveryCodes, hashRecoveryCode, hotp, otpauthUrl, totp, verifyTotp } from './totp';
import { SecretBox } from './secret-box';

describe('TOTP (RFC 6238 / 4226)', () => {
  // RFC 4226 Appendix D: secret "12345678901234567890"
  const rfcKey = Buffer.from('12345678901234567890');
  it('matches the RFC 4226 HOTP test values', () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(rfcKey, c))).toEqual(['755224', '287082', '359152', '969429', '520489']);
  });
  it('matches the RFC 6238 TOTP test values (SHA-1, 8 digits)', () => {
    const b32 = base32Encode(rfcKey);
    expect(totp(b32, 59_000, 8)).toBe('94287082');
    expect(totp(b32, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(b32, 20_000_000_000_000, 8)).toBe('65353130');
  });
  it('base32 round-trips', () => {
    const b = Buffer.from('any bytes here!');
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });
  it('accepts the current code and ±30 s of drift, nothing older', () => {
    const s = base32Encode(rfcKey);
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totp(s, now), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBe(false);
    expect(verifyTotp(s, '12345', now)).toBe(false);
    expect(verifyTotp(s, 'abcdef', now)).toBe(false);
  });
  it('builds an authenticator link', () => {
    expect(otpauthUrl('ABC', 'ops@fixli.pk')).toBe('otpauth://totp/Fixli%20Staff%3Aops%40fixli.pk?secret=ABC&issuer=Fixli%20Staff&algorithm=SHA1&digits=6&period=30');
  });
  it('recovery codes are unique, and only hashes are kept', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(hashes[0]).toBe(hashRecoveryCode(` ${codes[0].toUpperCase()} `));
    expect(hashes.join()).not.toContain(codes[0]);
  });
});

describe('SecretBox', () => {
  it('seals and opens; tampering is detected; the stored form never contains the secret', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'), 'x');
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'), 'x')).toThrow();
  });
});
