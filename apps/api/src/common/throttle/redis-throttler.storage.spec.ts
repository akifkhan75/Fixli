import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('rate limits when Redis is unreachable', () => {
  let t = 1_000_000;
  const storage = new RedisThrottlerStorage('redis://127.0.0.1:1', () => t);
  afterAll(async () => { await storage.onModuleDestroy(); });

  it('keeps counting in this process instead of failing every request', async () => {
    const a = await storage.increment('ip1', 60_000, 3, 60_000, 'default');
    expect(a).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(storage.degraded).toBe(true);
    await storage.increment('ip1', 60_000, 3, 60_000, 'default');
    await storage.increment('ip1', 60_000, 3, 60_000, 'default');
    const over = await storage.increment('ip1', 60_000, 3, 60_000, 'default');
    expect(over).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(over.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('counts each caller separately, and starts a fresh window once the old one ends', async () => {
    expect((await storage.increment('ip2', 60_000, 3, 60_000, 'default')).totalHits).toBe(1);
    t += 61_000;
    expect((await storage.increment('ip1', 60_000, 3, 60_000, 'default')).totalHits).toBe(1);
  });
});
