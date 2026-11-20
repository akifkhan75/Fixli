import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard rail (doc 27 F1.5): server logs must never carry phone numbers, passwords, tokens or
 * message text. Fails the build if a log call interpolates one of those fields.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('no personal data in logs', () => {
  it('no log call mentions phone, password, token, secret or message text', () => {
    const bad = /(logger|console)\.(log|warn|error|debug|info|verbose)\([^)]*\$\{[^}]*\.(phone|password|refreshToken|pushToken|token|totpSecret|secret|text)\b/;
    const hits = files(join(__dirname, '..')).flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i: i + 1, line })).filter((l) => bad.test(l.line)),
    );
    expect(hits.map((h) => `${h.f}:${h.i}: ${h.line.trim()}`)).toEqual([]);
  });
});
