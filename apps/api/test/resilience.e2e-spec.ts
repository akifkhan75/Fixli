import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * doc 27 F8.1 resilience: Redis dying must not take the API down. A real Redis is started and
 * killed by this test (port 6411, separate from any other suite).
 */
const PORT = 6411;
const startRedis = () => {
  const p = spawn('redis-server', ['--port', String(PORT), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  return p;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Redis outage (e2e)', () => {
  let app: INestApplication;
  let redis: ChildProcess;
  const http = () => request(app.getHttpServer());
  const ready = async () => (await http().get('/api/health/ready')).body;

  beforeAll(async () => {
    redis = startRedis();
    await sleep(800);
    process.env.REDIS_URL = `redis://127.0.0.1:${PORT}`;
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    redis.kill('SIGKILL');
    delete process.env.REDIS_URL;
  });

  it('with Redis up, everything is "ok"', async () => {
    expect((await http().get('/api/config/countries')).status).toBe(200);
    const body = await ready();
    expect(body.checks.redis.ok).toBe(true);
    expect(body.status).toBe('ok');
  });

  it('with Redis killed, requests still work, rate limits still bite, and readiness says "degraded" (not down)', async () => {
    redis.kill('SIGKILL');
    await sleep(500);

    // Normal traffic is unaffected.
    for (let i = 0; i < 5; i++) expect((await http().get('/api/config/countries')).status).toBe(200);

    // The sign-in limit (10 a minute) is still enforced, counted in this server's memory.
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await http().post('/api/auth/login').send({ phone: '+923001111111', countryCode: 'PK', password: 'x', deviceId: 'dev-resilience-1' })).status);
    expect(statuses).not.toContain(500);
    expect(statuses).toContain(429);

    const res = await http().get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.redis.ok).toBe(false);
    expect(res.body.checks.database.ok).toBe(true);
  }, 60_000);

  it('when Redis comes back, readiness returns to "ok" by itself', async () => {
    redis = startRedis();
    let body: any;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      body = await ready();
      if (body.checks.redis.ok) break;
    }
    expect(body.checks.redis.ok).toBe(true);
    expect(body.status).toBe('ok');
  }, 60_000);
});
