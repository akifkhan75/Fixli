import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// RFC 6238 time-based one-time codes (what Google Authenticator, 1Password, Authy use).
// Small enough to own: SHA-1, 30-second steps, 6 digits, ±1 step of clock drift.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, as RFC 4226 recommends
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totp(secretB32: string, at = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 1000 / 30), digits);
}

/** Accepts the current code or one step either side (clock drift). Constant-time compare. */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  return matchTotpStep(secretB32, code, at) !== null;
}

/** The time step the code belongs to (for replay protection), or null if it doesn't match. */
export function matchTotpStep(secretB32: string, code: string, at = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const step = Math.floor(at / 1000 / 30);
  for (const d of [-1, 0, 1]) if (timingSafeEqual(Buffer.from(hotp(key, step + d)), Buffer.from(code))) return step + d;
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'Fixli Staff'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Ten single-use recovery codes, shown once; only their hashes are stored. */
export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase().replace(/\s/g, '')).digest('hex');
}
