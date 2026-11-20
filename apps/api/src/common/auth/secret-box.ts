import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM for small secrets at rest (staff authenticator secrets). Output: v1.<iv>.<tag>.<data>
 * (base64url). The key comes from TOTP_ENCRYPTION_KEY (32 bytes, base64); required in production.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyB64: string | undefined, fallbackSeed: string) {
    this.key = keyB64 ? Buffer.from(keyB64, 'base64') : createHash('sha256').update(`totp:${fallbackSeed}`).digest();
    if (this.key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be 32 bytes (base64)');
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split('.');
    if (v !== 'v1') throw new Error('Unknown secret format');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  }
}
