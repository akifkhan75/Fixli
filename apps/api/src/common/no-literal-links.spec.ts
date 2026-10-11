import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Server links to app screens go through `routes` (@fixli/shared), which the app tests against its screens. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('notification links', () => {
  it('no hand-written app paths in the server', () => {
    const bad = /url:\s*[`'"]\//;
    const hits = files(join(__dirname, '..')).flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i: i + 1, line })).filter((l) => bad.test(l.line)));
    expect(hits.map((h) => `${h.f}:${h.i}`)).toEqual([]);
  });
});
