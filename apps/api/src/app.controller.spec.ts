import { AppController } from './app.controller';

const res = () => ({ status: jest.fn() });
const make = (opts: { db?: boolean; beats?: { name: string; ageMs: number; stale: boolean; everyMs: number }[]; ops?: string; sockets?: number } = {}) => {
  const prisma = { $queryRaw: jest.fn(async () => { if (opts.db === false) throw new Error('connection refused'); return [{ '?column?': 1 }]; }) };
  const lease = { heartbeats: jest.fn(() => opts.beats ?? []) };
  const realtime = { connectedSockets: jest.fn(() => opts.sockets ?? 7) };
  const config = { get: jest.fn((k: string) => (k === 'OPS_TOKEN' ? opts.ops : undefined)) };
  return new AppController(prisma as any, lease as any, realtime as any, config as any);
};

describe('health', () => {
  it('liveness needs nothing: it answers even when everything else is down', () => {
    expect(make({ db: false }).healthCheck()).toMatchObject({ status: 'ok', service: 'fixli-api' });
  });

  it('ready: everything fine is "ok" with HTTP 200', async () => {
    const r = res();
    const out: any = await make({ beats: [{ name: 'sos', everyMs: 15000, ageMs: 5000, stale: false }] }).ready(r as any);
    expect(out.status).toBe('ok');
    expect(out.checks).toMatchObject({ database: { ok: true }, background: { ok: true } });
    expect(r.status).not.toHaveBeenCalled();
    expect(out.ops).toBeUndefined();
  });

  it('ready: the database being down is "down" with HTTP 503, so the load balancer stops sending traffic', async () => {
    const r = res();
    const out: any = await make({ db: false }).ready(r as any);
    expect(out.status).toBe('down');
    expect(out.checks.database).toMatchObject({ ok: false });
    expect(r.status).toHaveBeenCalledWith(503);
  });

  it('ready: a background job that went quiet is "degraded" but still HTTP 200 (still serving; someone should look)', async () => {
    const r = res();
    const out: any = await make({ beats: [{ name: 'job-lifecycle', everyMs: 60000, ageMs: 300000, stale: true }] }).ready(r as any);
    expect(out.status).toBe('degraded');
    expect(out.checks.background.detail).toContain('job-lifecycle');
    expect(r.status).not.toHaveBeenCalled();
  });

  it('socket count and memory are shown only with the right ops token', async () => {
    const c = make({ ops: 'a'.repeat(24), sockets: 42, beats: [{ name: 'sos', everyMs: 15000, ageMs: 1000, stale: false }] });
    expect(((await c.ready(res() as any, 'wrong')) as any).ops).toBeUndefined();
    expect(((await c.ready(res() as any, undefined)) as any).ops).toBeUndefined();
    const ok: any = await c.ready(res() as any, 'a'.repeat(24));
    expect(ok.ops).toMatchObject({ connectedSockets: 42, backgroundJobs: [{ name: 'sos', stale: false }] });
    // No token configured at all: nobody gets them.
    expect(((await make().ready(res() as any, 'anything-long-enough-xxxxxxxx')) as any).ops).toBeUndefined();
  });
});
