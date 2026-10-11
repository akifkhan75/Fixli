import { ChatGateway } from './chat.gateway';

describe('ChatGateway (socket security)', () => {
  const chat = { typing: jest.fn() };
  const jwt = { verify: jest.fn() };
  const prisma = { session: { findFirst: jest.fn() }, jobRequest: { findFirst: jest.fn() }, conversation: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() } as any };
  const emit = jest.fn();
  let revoked: ((p: { sessionIds: string[] }) => void) | undefined;
  const events = { on: jest.fn((_: string, fn: any) => { revoked = fn; return () => undefined; }) };
  const disconnectSockets = jest.fn();
  const location = { accept: jest.fn() };
  let gateway: ChatGateway;

  const client = (over: any = {}) => ({
    handshake: { auth: { token: 'tok' } },
    data: {},
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...over,
  });

  beforeEach(() => {
    gateway = new ChatGateway(chat as any, jwt as any, prisma as any, events as any, { attach: jest.fn() } as any, location as any);
    gateway.server = { to: jest.fn().mockReturnValue({ emit }), in: jest.fn().mockReturnValue({ disconnectSockets }) } as any;
  });
  afterEach(() => { jest.resetAllMocks(); events.on.mockImplementation((_: string, fn: any) => { revoked = fn; return () => undefined; }); });

  it('rejects a connection with no/invalid token (cannot just claim a userId)', async () => {
    jwt.verify.mockImplementation(() => { throw new Error('bad'); });
    const c = client({ handshake: { auth: {}, query: { userId: 'victim' } } });
    await gateway.handleConnection(c as any);
    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose session was revoked (logged out)', async () => {
    jwt.verify.mockReturnValue({ sub: 'u1', sid: 's1' });
    prisma.session.findFirst.mockResolvedValue(null);
    const c = client();
    await gateway.handleConnection(c as any);
    expect(c.disconnect).toHaveBeenCalled();
  });

  it('puts an authenticated user in their own rooms only', async () => {
    jwt.verify.mockReturnValue({ sub: 'u1', sid: 's1' });
    prisma.session.findFirst.mockResolvedValue({ user: { id: 'u1', type: 'worker' } });
    const c = client();
    await gateway.handleConnection(c as any);
    expect(c.join).toHaveBeenCalledWith(['user:u1', 'role:worker', 'session:s1']);
    expect(c.data.userId).toBe('u1');
    expect(c.emit).toHaveBeenCalledWith('ready', { userId: 'u1' });
  });

  it('signing out a session drops that device\'s live connection at once', () => {
    (gateway.server.in as jest.Mock).mockReturnValue({ disconnectSockets });
    revoked!({ sessionIds: ['s1', 's2'] });
    expect(gateway.server.in).toHaveBeenCalledWith('session:s1');
    expect(gateway.server.in).toHaveBeenCalledWith('session:s2');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('messages are not sent over the socket (REST only); typing goes through the throttled service', async () => {
    expect((gateway as any).handleMessage).toBeUndefined();
    const c = client({ data: { userId: 'u1', userType: 'customer' } });
    await gateway.handleTyping(c as any, { threadId: 't1' });
    expect(chat.typing).toHaveBeenCalledWith('u1', 't1');
    await gateway.handleTyping(c as any, { threadId: 't1', extra: 'x' });
    expect(chat.typing).toHaveBeenCalledTimes(1);
  });

  it('only a worker can send location; the server decides the receiver from the job', async () => {
    const payload = { jobId: 'j1', latitude: 24.8, longitude: 67.0 };
    await gateway.handleLocationUpdate(client({ data: { userId: 'c1', userType: 'customer' } }) as any, payload);
    expect(location.accept).not.toHaveBeenCalled();

    location.accept.mockResolvedValue({ customerId: 'c9', update: { jobId: 'j1', etaMinutes: 7 } });
    await gateway.handleLocationUpdate(client({ data: { userId: 'w1', userType: 'worker' } }) as any, payload);
    expect(location.accept).toHaveBeenCalledWith('w1', payload);
    expect(gateway.server.to).toHaveBeenCalledWith('user:c9');
    expect(emit).toHaveBeenCalledWith('locationUpdate', { jobId: 'j1', etaMinutes: 7 });
  });

  it('drops location the service refuses (not assigned, not on the way, too frequent)', async () => {
    location.accept.mockResolvedValue(null);
    await gateway.handleLocationUpdate(client({ data: { userId: 'w1', userType: 'worker' } }) as any, { jobId: 'other', latitude: 1, longitude: 1 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects out-of-range coordinates', async () => {
    await gateway.handleLocationUpdate(
      client({ data: { userId: 'w1', userType: 'worker' } }) as any,
      { jobId: 'j1', latitude: 999, longitude: 1 },
    );
    expect(location.accept).not.toHaveBeenCalled();
  });
});
