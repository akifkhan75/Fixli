jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../services/socket', () => ({ realtime: { on: jest.fn(() => () => undefined) } }));
jest.mock('../services/connectivity', () => ({ connectivity: { online: true, subscribe: jest.fn(() => () => undefined) } }));
import { ApiError } from '../services/api';
import { backoffMs, Outbox, type OutboxHandler } from '../services/outbox';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: jest.fn(async (k: string) => m.get(k) ?? null), setItem: jest.fn(async (k: string, v: string) => { m.set(k, v); }), removeItem: jest.fn(async (k: string) => { m.delete(k); }) } as any;
};
const offline = () => new ApiError("You're offline.", 0, 'OFFLINE');

const made: Outbox[] = [];
function make(send: OutboxHandler['send'], extra: Partial<OutboxHandler> = {}, storage = memory(), clock = { t: 1_000_000 }) {
  const box = new Outbox({ job_action: { describe: (p: any) => p.label, send, ...extra } }, storage, () => clock.t);
  made.push(box);
  return { box, storage, clock };
}

describe('outbox', () => {
  afterEach(() => { made.splice(0).forEach((b) => b.dispose()); });

  it('sends in the order things were done', async () => {
    const order: string[] = [];
    const { box } = make(async (p: any) => { order.push(p.label); });
    await box.add('job_action', 'u1', 'job1', { label: 'on my way' });
    await box.add('job_action', 'u1', 'job1', { label: 'arrived' });
    await box.flush();
    expect(order).toEqual(['on my way', 'arrived']);
    expect(await box.list()).toEqual([]);
  });

  it('with no connection it keeps everything, in order, and waits with growing delays', async () => {
    const send = jest.fn(async () => { throw offline(); });
    const { box, clock } = make(send);
    await box.add('job_action', 'u1', 'job1', { label: 'a' });
    await box.add('job_action', 'u1', 'job1', { label: 'b' });
    await box.flush();
    expect(send).toHaveBeenCalledTimes(1); // "b" must not overtake "a"
    const [a] = await box.list();
    expect(a.attempts).toBe(1);
    expect(a.nextAttemptAt).toBe(clock.t + 2_000);
    await box.flush(); // not due yet: nothing is sent
    expect(send).toHaveBeenCalledTimes(1);
    clock.t += 2_000;
    await box.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect((await box.list())[0].nextAttemptAt).toBe(clock.t + 4_000);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });

  it('when the connection returns it sends at once, ignoring the wait', async () => {
    let up = false;
    const send = jest.fn(async () => { if (!up) throw offline(); return 'ok'; });
    const { box } = make(send);
    await box.add('job_action', 'u1', 'job1', { label: 'a' });
    await box.flush();
    expect(await box.list()).toHaveLength(1);
    up = true;
    await box.flush({ now: true });
    expect(await box.list()).toHaveLength(0);
  });

  it('a server "no" is shown as failed, never retried by itself, and holds back later steps of that job only', async () => {
    const sent: string[] = [];
    const { box } = make(async (p: any) => {
      if (p.label === 'bad') throw new ApiError('You are not assigned to this job', 403);
      sent.push(p.label);
    });
    await box.add('job_action', 'u1', 'job1', { label: 'bad' });
    await box.add('job_action', 'u1', 'job1', { label: 'after bad' });
    await box.add('job_action', 'u1', 'job2', { label: 'other job' });
    await box.flush();
    await box.flush({ now: true });
    expect(sent).toEqual(['other job']);
    const items = await box.list();
    expect(items.find((i) => i.payload.label === 'bad')).toMatchObject({ status: 'failed', error: 'You are not assigned to this job' });
    expect(items.find((i) => i.payload.label === 'after bad')?.status).toBe('queued');
    // The person drops the failed one: the next goes.
    await box.discard(items.find((i) => i.payload.label === 'bad')!.id);
    await box.flush();
    expect(sent).toEqual(['other job', 'after bad']);
  });

  it('timeouts, rate limits and server errors are retried, not shown as failed', async () => {
    for (const status of [408, 429, 500, 503]) {
      const { box } = make(async () => { throw new ApiError('busy', status); });
      await box.add('job_action', 'u1', 'job1', { label: 'a' });
      await box.flush();
      expect((await box.list())[0]).toMatchObject({ status: 'queued', attempts: 1 });
    }
  });

  it('a repeat the server refuses because it already worked counts as done', async () => {
    const alreadyDone = jest.fn(async () => true);
    const { box } = make(async () => { throw new ApiError('Cannot go from EN_ROUTE to EN_ROUTE', 400); }, { alreadyDone });
    const sent = jest.fn();
    box.subscribe((e) => { if (e.type === 'sent') sent(); });
    await box.add('job_action', 'u1', 'job1', { label: 'a' });
    await box.flush();
    expect(alreadyDone).toHaveBeenCalled();
    expect(await box.list()).toEqual([]);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('survives the app closing: a new outbox on the same storage sends what was waiting, with the same id', async () => {
    const storage = memory();
    const ids: string[] = [];
    const first = make(async () => { throw offline(); }, {}, storage);
    const id = await first.box.add('job_action', 'u1', 'job1', { label: 'a' });
    await first.box.flush();
    const second = make(async (_p, ctx) => { ids.push(ctx.id); }, {}, storage);
    await second.box.flush({ now: true });
    expect(ids).toEqual([id]);
    expect(await second.box.list()).toEqual([]);
  });

  it('adding the same id twice queues it once (a double tap)', async () => {
    const { box } = make(async () => { throw offline(); });
    await box.add('job_action', 'u1', 'job1', { label: 'a' }, 'same');
    await box.add('job_action', 'u1', 'job1', { label: 'a' }, 'same');
    expect(await box.list()).toHaveLength(1);
  });

  it('an uploaded-photo id is remembered, so a retry does not upload the photos again', async () => {
    let calls = 0;
    const { box } = make(async (p: any, ctx) => {
      calls += 1;
      if (calls === 1) { await ctx.patch({ evidence: { photoUploadIds: ['up1'] } }); throw offline(); }
      expect(p.evidence).toEqual({ photoUploadIds: ['up1'] });
    });
    await box.add('job_action', 'u1', 'job1', { label: 'start', evidence: { localPhotoUris: ['file://a.jpg'] } });
    await box.flush();
    await box.flush({ now: true });
    expect(calls).toBe(2);
  });

  it('signing out removes that account\'s items from the phone', async () => {
    const { box, storage } = make(async () => { throw offline(); });
    await box.add('job_action', 'u1', 'job1', { label: 'a' });
    await box.add('job_action', 'u2', 'job9', { label: 'b' });
    await box.clear('u1');
    expect((await box.list()).map((i) => i.userId)).toEqual(['u2']);
    await box.clear();
    expect(storage.m.size).toBe(0);
  });
});
