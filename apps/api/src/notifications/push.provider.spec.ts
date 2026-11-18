import { ExpoPushProvider, PushMessage } from './push.provider';

const msgs = (n: number): PushMessage[] => Array.from({ length: n }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: 't', body: 'b' }));

describe('ExpoPushProvider', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => { fetchMock.mockReset(); (global as any).fetch = fetchMock; });
  afterAll(() => { global.fetch = realFetch; });
  const reply = (data: any, status = 200) => ({ status, json: async () => ({ data }) });

  it('maps tickets back to messages and flags dead tokens', async () => {
    fetchMock.mockResolvedValue(reply([
      { status: 'ok' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } },
    ]));
    const r = await new ExpoPushProvider('https://push.example/send', 'tok').send(msgs(3));
    expect(r).toEqual([
      { ok: true },
      { ok: false, error: 'DeviceNotRegistered', deadToken: true },
      { ok: false, error: 'MessageRateExceeded', deadToken: false },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://push.example/send');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)[0]).toMatchObject({ sound: 'default', priority: 'high' });
  });

  it('sends no auth header without a token', async () => {
    fetchMock.mockResolvedValue(reply([{ status: 'ok' }]));
    await new ExpoPushProvider('u').send(msgs(1));
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('batches in chunks of 100', async () => {
    fetchMock.mockImplementation(async (_u: string, init: any) => reply(JSON.parse(init.body).map(() => ({ status: 'ok' }))));
    const r = await new ExpoPushProvider('u').send(msgs(250));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r).toHaveLength(250);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  it('a transport failure never throws and does not condemn the token', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(new ExpoPushProvider('u').send(msgs(2))).resolves.toEqual([
      { ok: false, error: 'transport', deadToken: false },
      { ok: false, error: 'transport', deadToken: false },
    ]);
  });

  it('an unreadable or empty reply is reported with the HTTP status', async () => {
    fetchMock.mockResolvedValue({ status: 502, json: async () => { throw new Error('html'); } });
    await expect(new ExpoPushProvider('u').send(msgs(1))).resolves.toEqual([{ ok: false, error: 'HTTP 502', deadToken: false }]);
  });
});
