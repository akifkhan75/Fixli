jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
import { Outbox, backoffMs, TTL_URGENT_MS, TTL_SCHEDULED_MS, type KeyValueStore, type OutboxItem } from '../services/offline';

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); } };
};
const base = { userId: 'u1', method: 'POST' as const, endpoint: '/x', label: 'thing' };

describe('Outbox', () => {
  let t = 1_000_000;
  const now = () => t;
  let box: Outbox;
  beforeEach(() => { t = 1_000_000; box = new Outbox(memory(), now); });

  it('backs off 5s, 15s, then 45s and stays at 45s', () => {
    expect([1, 2, 3, 4, 9].map(backoffMs)).toEqual([5000, 15000, 45000, 45000, 45000]);
  });

  it('queues once per id, so a double tap cannot send twice', async () => {
    await box.enqueue({ ...base, id: 'k1', kind: 'JOB', ttlMs: TTL_URGENT_MS });
    await box.enqueue({ ...base, id: 'k1', kind: 'JOB', ttlMs: TTL_URGENT_MS });
    expect(await box.list()).toHaveLength(1);
  });

  it('survives a restart (persisted)', async () => {
    const store = memory();
    await new Outbox(store, now).enqueue({ ...base, id: 'k1', kind: 'MESSAGE', ttlMs: TTL_SCHEDULED_MS });
    expect(await new Outbox(store, now).list()).toHaveLength(1);
  });

  it('sends in order: job before the messages about it, regardless of queue order', async () => {
    await box.enqueue({ ...base, id: 'm1', kind: 'MESSAGE', ttlMs: TTL_SCHEDULED_MS });
    await box.enqueue({ ...base, id: 'j1', kind: 'JOB', ttlMs: TTL_SCHEDULED_MS });
    const order: string[] = [];
    const r = await box.flush('u1', async (i) => { order.push(i.id); return 'sent'; });
    expect(order).toEqual(['j1', 'm1']);
    expect(r.sent).toEqual(['j1', 'm1']);
    expect(await box.list()).toHaveLength(0);
  });

  it('a failed item is retried later with backoff; nothing is sent twice after success', async () => {
    await box.enqueue({ ...base, id: 'j1', kind: 'JOB', ttlMs: TTL_SCHEDULED_MS });
    const send = jest.fn<Promise<'sent' | 'retry'>, [OutboxItem]>().mockResolvedValueOnce('retry').mockResolvedValue('sent');
    await box.flush('u1', send);
    expect(send).toHaveBeenCalledTimes(1);
    await box.flush('u1', send); // too soon: still backing off
    expect(send).toHaveBeenCalledTimes(1);
    t += 6000;
    await box.flush('u1', send);
    expect(send).toHaveBeenCalledTimes(2);
    t += 60_000;
    await box.flush('u1', send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await box.list()).toHaveLength(0);
  });

  it('retryNow (connection is back) skips the wait', async () => {
    await box.enqueue({ ...base, id: 'j1', kind: 'JOB', ttlMs: TTL_SCHEDULED_MS });
    const send = jest.fn<Promise<'sent' | 'retry'>, [OutboxItem]>().mockResolvedValueOnce('retry').mockResolvedValue('sent');
    await box.flush('u1', send);
    await box.retryNow('u1');
    await box.flush('u1', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a server rejection drops the item and holds back what depended on it', async () => {
    await box.enqueue({ ...base, id: 'j1', kind: 'JOB', ttlMs: TTL_SCHEDULED_MS });
    await box.enqueue({ ...base, id: 'm1', kind: 'MESSAGE', dependsOn: ['j1'], ttlMs: TTL_SCHEDULED_MS });
    const send = jest.fn(async (i: OutboxItem) => (i.id === 'j1' ? ('rejected' as const) : ('sent' as const)));
    const r = await box.flush('u1', send);
    expect(r.rejected).toEqual(['j1']);
    expect(send).toHaveBeenCalledTimes(1); // the message waited, was not sent in the same pass
  });

  it('urgent items go stale after 20 minutes: not sent, handed back to ask the user', async () => {
    await box.enqueue({ ...base, id: 'j1', kind: 'JOB', ttlMs: TTL_URGENT_MS });
    t += TTL_URGENT_MS + 1;
    const send = jest.fn(async () => 'sent' as const);
    const r = await box.flush('u1', send);
    expect(send).not.toHaveBeenCalled();
    expect(r.expired.map((i) => i.id)).toEqual(['j1']);
    await box.renew('j1', 'u1', TTL_URGENT_MS);
    const r2 = await box.flush('u1', send);
    expect(r2.sent).toEqual(['j1']);
  });

  it('only sends the signed-in user\'s items', async () => {
    await box.enqueue({ ...base, userId: 'other', id: 'j1', kind: 'JOB', ttlMs: TTL_SCHEDULED_MS });
    const send = jest.fn(async () => 'sent' as const);
    await box.flush('u1', send);
    expect(send).not.toHaveBeenCalled();
    expect(await box.list('other')).toHaveLength(1);
  });

  it('concurrent flushes do not double-send', async () => {
    await box.enqueue({ ...base, id: 'j1', kind: 'JOB', ttlMs: TTL_SCHEDULED_MS });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = jest.fn(async () => { await gate; return 'sent' as const; });
    const a = box.flush('u1', send);
    const b = box.flush('u1', send);
    release();
    await Promise.all([a, b]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
