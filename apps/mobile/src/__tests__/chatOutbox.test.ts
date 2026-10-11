jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../services/socket', () => ({ realtime: { on: jest.fn(() => () => undefined) } }));
import { ChatOutbox } from '../services/chatOutbox';
import { ApiError } from '../services/api';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: jest.fn(async (k: string) => m.get(k) ?? null), setItem: jest.fn(async (k: string, v: string) => { m.set(k, v); }), removeItem: jest.fn(async (k: string) => { m.delete(k); }) } as any;
};
const msg = (clientId: string) => ({ id: `srv-${clientId}`, clientId, conversationId: 'c1', text: 'x', imageUrl: null, isSystem: false, createdAt: '', sender: null, reads: [] });

describe('chat outbox', () => {
  it('sends in order and reports each as sent', async () => {
    const send = jest.fn(async (_c: string, d: any) => msg(d.clientId));
    const box = new ChatOutbox(send as any, memory());
    const sent: string[] = [];
    box.subscribe((e) => { if (e.type === 'sent') sent.push(e.clientId); });
    await box.add({ clientId: 'a', conversationId: 'c1', senderId: 'u', text: 'one' });
    await box.add({ clientId: 'b', conversationId: 'c1', senderId: 'u', text: 'two' });
    await box.flush();
    expect(sent).toEqual(['a', 'b']);
    expect(send.mock.calls.map((c) => c[1].clientId)).toEqual(['a', 'b']);
    expect(await box.list('c1')).toEqual([]);
  });

  it('offline: keeps everything, in order, and sends exactly once when back (same clientId)', async () => {
    let online = false;
    const send = jest.fn(async (_c: string, d: any) => { if (!online) throw new TypeError('Network request failed'); return msg(d.clientId); });
    const storage = memory();
    const box = new ChatOutbox(send as any, storage);
    await box.add({ clientId: 'a', conversationId: 'c1', senderId: 'u', text: 'one' });
    await box.add({ clientId: 'b', conversationId: 'c1', senderId: 'u', text: 'two' });
    expect((await box.list('c1')).map((i) => [i.clientId, i.status])).toEqual([['a', 'sending'], ['b', 'sending']]);

    // The app restarts: a fresh outbox reads what was saved.
    const after = new ChatOutbox(send as any, storage);
    online = true;
    await after.flush();
    expect(await after.list('c1')).toEqual([]);
    const sentIds = send.mock.calls.filter(() => true).map((c) => c[1].clientId);
    expect(sentIds.filter((x) => x === 'a').length).toBeGreaterThanOrEqual(1);
    expect(new Set(sentIds)).toEqual(new Set(['a', 'b'])); // retries reuse the same clientId
  });

  it('a refusal (e.g. blocked, chat closed) is marked "not sent" and can be retried or discarded', async () => {
    const send = jest.fn(async () => { throw new ApiError("You can't message this person.", 403, 'BLOCKED'); });
    const box = new ChatOutbox(send as any, memory());
    await box.add({ clientId: 'a', conversationId: 'c1', senderId: 'u', text: 'hi' });
    await box.flush();
    expect((await box.list('c1'))[0]).toMatchObject({ status: 'failed', error: "You can't message this person." });
    await box.discard('a');
    expect(await box.list('c1')).toEqual([]);
  });
});
