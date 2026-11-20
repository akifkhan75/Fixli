import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Field-level encryption for identity numbers (CNIC etc., doc 22 L2).
 * AES-256-GCM, random 96-bit IV per value, authenticated: tampering fails to decrypt.
 * Stored form: `v1:<iv>:<tag>:<ciphertext>` (base64url). The `v1` prefix lets a future key or
 * algorithm rotation read old values. The key lives only in the environment (FIELD_ENCRYPTION_KEY,
 * base64 of 32 random bytes: `openssl rand -base64 32`), never in the database or git.
 */
const PREFIX = 'v1:';
const logger = new Logger('FieldCrypto');
let warnedDevKey = false;

function key(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be base64 of exactly 32 bytes');
    return buf;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('FIELD_ENCRYPTION_KEY is required in production');
  if (!warnedDevKey) {
    warnedDevKey = true;
    logger.warn('FIELD_ENCRYPTION_KEY is not set: using a fixed development key. Never do this in production.');
  }
  return createHash('sha256').update('fixli-dev-only-field-key').digest();
}

export const isEncrypted = (v: string | null | undefined): v is string => !!v && v.startsWith(PREFIX);

/** Parse a base64 key (as in FIELD_ENCRYPTION_KEY). Used by the rotation tool, which holds two keys at once. */
export function parseKey(base64: string): Buffer {
  const buf = Buffer.from(base64.trim(), 'base64');
  if (buf.length !== 32) throw new Error('A field encryption key must be base64 of exactly 32 bytes');
  return buf;
}

export function encryptField(plain: string, withKey: Buffer = key()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', withKey, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

/** Throws if the value was tampered with or the key is wrong. Legacy plaintext (pre-backfill) is returned as is. */
export function decryptField(stored: string, withKey?: Buffer): string {
  if (!isEncrypted(stored)) return stored;
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(':');
  if (!iv || !tag || !ct) throw new Error('Malformed encrypted field');
  const decipher = createDecipheriv('aes-256-gcm', withKey ?? key(), Buffer.from(iv, 'base64url'), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * "42101-1234567-3" -> "42101-*******-3". Anything that is not 13 digits is masked
 * generically so a malformed value never leaks.
 */
export function maskIdNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const plain = isEncrypted(value) ? safeDecrypt(value) : value;
  if (plain == null) return '***';
  const digits = plain.replace(/\D/g, '');
  if (digits.length === 13) return `${digits.slice(0, 5)}-*******-${digits.slice(12)}`;
  return plain.length <= 2 ? '***' : `${'*'.repeat(Math.max(3, plain.length - 2))}${plain.slice(-1)}`;
}

function safeDecrypt(v: string): string | null {
  try { return decryptField(v); } catch { return null; }
}
