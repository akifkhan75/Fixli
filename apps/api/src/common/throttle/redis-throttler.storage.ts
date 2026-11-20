import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createClient } from 'redis';

// Atomic: count the hit, start the window on the first hit, and block once over the limit.
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return { hits, ttl, blocked }`;

/** One window of counts held in this process (used only while Redis is unreachable). */
interface LocalHit { hits: number; expiresAt: number; blockedUntil: number }

/**
 * Rate limits shared by every API instance, so a login brute-force can't spread across servers.
 *
 * If Redis is unreachable the API must not go down with it: limits fall back to counters in this
 * process (each instance counts on its own, so the limit is looser across many instances, but
 * brute-force protection stays on), and it logs once a minute until Redis is back.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly client: ReturnType<typeof createClient>;
  private ready: Promise<unknown>;
  private readonly local = new Map<string, LocalHit>();
  private lastWarn = 0;
  /** True while we are using the in-process fallback. */
  degraded = false;

  constructor(url: string, private readonly now: () => number = Date.now) {
    this.client = createClient({ url, socket: { reconnectStrategy: (n) => Math.min(n * 200, 5_000), connectTimeout: 2_000 } });
    this.client.on('error', (e) => this.warn(`Redis (rate limits): ${e.message}`));
    this.ready = this.client.connect().catch((e) => this.warn(`Redis (rate limits) not connected: ${e.message}`));
  }

  private warn(message: string) {
    if (this.now() - this.lastWarn < 60_000) return;
    this.lastWarn = this.now();
    Logger.error(`${message}. Rate limits are counted per server until it is back.`, RedisThrottlerStorage.name);
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const k = `throttle:${throttlerName}:${key}`;
    try {
      if (!this.client.isReady) throw new Error('not connected');
      await this.ready;
      const [hits, ttlMs, blockMs] = (await this.client.eval(SCRIPT, {
        keys: [k, `${k}:blocked`], arguments: [String(ttl), String(limit), String(blockDuration || ttl)],
      })) as number[];
      this.degraded = false;
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
        isBlocked: blockMs > 0,
        timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
      };
    } catch (e) {
      this.degraded = true;
      this.warn(`Redis (rate limits) error: ${(e as Error).message}`);
      return this.incrementLocal(k, ttl, limit, blockDuration);
    }
  }

  private incrementLocal(k: string, ttl: number, limit: number, blockDuration: number) {
    const now = this.now();
    if (this.local.size > 10_000) for (const [key, v] of this.local) if (v.expiresAt < now && v.blockedUntil < now) this.local.delete(key);
    let h = this.local.get(k);
    if (!h || h.expiresAt <= now) h = { hits: 0, expiresAt: now + ttl, blockedUntil: h?.blockedUntil ?? 0 };
    h.hits += 1;
    if (h.blockedUntil <= now && h.hits > limit) h.blockedUntil = now + (blockDuration || ttl);
    this.local.set(k, h);
    return {
      totalHits: h.hits,
      timeToExpire: Math.max(0, Math.ceil((h.expiresAt - now) / 1000)),
      isBlocked: h.blockedUntil > now,
      timeToBlockExpire: Math.max(0, Math.ceil((h.blockedUntil - now) / 1000)),
    };
  }

  async onModuleDestroy() {
    // quit() waits for the server and never returns if Redis is gone: give it a second, then cut the connection.
    await Promise.race([this.client.quit().catch(() => undefined), new Promise((r) => setTimeout(r, 1_000))]);
    await this.client.disconnect().catch(() => undefined);
  }
}
