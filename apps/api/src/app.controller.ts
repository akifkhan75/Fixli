import { Controller, Get, Headers, OnModuleDestroy, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { createClient } from 'redis';
import { Public } from './common/decorators/public.decorator';
import { LeaseService } from './common/lease/lease.service';
import { PrismaService } from './database/prisma.service';
import { RealtimeService } from './realtime/realtime.service';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

@ApiTags('health')
@Controller()
export class AppController implements OnModuleDestroy {
  private redis?: ReturnType<typeof createClient>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lease: LeaseService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  async onModuleDestroy() {
    if (!this.redis) return;
    await Promise.race([this.redis.quit().catch(() => undefined), new Promise((r) => setTimeout(r, 1_000))]);
    await this.redis.disconnect().catch(() => undefined);
  }

  /** "Is the process up?" Cheap and dependency-free: what the container restarts on. */
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness' })
  healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString(), service: 'fixli-api', version: this.config.get('APP_RELEASE') ?? '2.0.0' };
  }

  /**
   * "Can it do its job?" For the load balancer and the alerts.
   *  - database down  -> 503 (take it out of rotation)
   *  - Redis down, or a background job gone quiet -> 200 with status "degraded" (still serving, but page someone)
   * With the `x-ops-token` header, also socket count and memory.
   */
  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness: database, Redis, background jobs' })
  async ready(@Res({ passthrough: true }) res: Response, @Headers('x-ops-token') opsToken?: string) {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000);
      checks.database = { ok: true };
    } catch (e) {
      checks.database = { ok: false, detail: (e as Error).message };
    }

    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      try {
        this.redis ??= createClient({ url: redisUrl, socket: { connectTimeout: 2_000, reconnectStrategy: (n) => Math.min(n * 200, 5_000) } });
        this.redis.on('error', () => undefined);
        if (!this.redis.isOpen) void this.redis.connect().catch(() => undefined);
        await withTimeout(this.redis.ping(), 2_000);
        checks.redis = { ok: true };
      } catch (e) {
        checks.redis = { ok: false, detail: (e as Error).message };
      }
    }

    const beats = this.lease.heartbeats();
    if (beats.length) {
      const stale = beats.filter((b) => b.stale).map((b) => b.name);
      checks.background = stale.length ? { ok: false, detail: `no tick from: ${stale.join(', ')}` } : { ok: true };
    }

    const down = !checks.database.ok;
    const degraded = Object.values(checks).some((c) => !c.ok);
    if (down) res.status(503);

    const out: Record<string, unknown> = {
      status: down ? 'down' : degraded ? 'degraded' : 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
    if (this.opsAllowed(opsToken)) {
      out.ops = {
        connectedSockets: this.realtime.connectedSockets(),
        uptimeSeconds: Math.round(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        backgroundJobs: beats.map((b) => ({ name: b.name, secondsSinceTick: Math.round(b.ageMs / 1000), stale: b.stale })),
      };
    }
    return out;
  }

  private opsAllowed(given?: string): boolean {
    const want = this.config.get<string>('OPS_TOKEN');
    if (!want || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
