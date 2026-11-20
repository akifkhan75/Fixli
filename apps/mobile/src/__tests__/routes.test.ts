import { existsSync } from 'fs';
import { join } from 'path';
import { ROUTE_PATTERNS, routes } from '@fixli/shared';

/** Every link the server can put in a notification opens a real screen (doc 26 7.7). */
describe('notification links', () => {
  const appDir = join(__dirname, '..', '..', 'app');
  it.each(ROUTE_PATTERNS)('%s has a screen', (pattern) => {
    const rel = pattern.replace(/:id/g, '[id]');
    expect(existsSync(join(appDir, `${rel}.tsx`)) || existsSync(join(appDir, rel, 'index.tsx'))).toBe(true);
  });
  it('the builders produce those patterns', () => {
    const built = [routes.customerJob('x'), routes.workerJob('x'), routes.thread('x'), routes.workerJobs(), routes.workerToday(), routes.workerEarnings(), routes.workerDocuments()];
    for (const b of built) expect(ROUTE_PATTERNS.some((p) => new RegExp(`^${p.replace(/[()]/g, '\\$&').replace(':id', '[^/]+')}$`).test(b))).toBe(true);
  });
});
