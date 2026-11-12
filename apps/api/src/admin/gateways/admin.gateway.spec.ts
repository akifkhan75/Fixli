import { AdminGateway } from './admin.gateway';

describe('AdminGateway (socket security)', () => {
  const jwt = { verify: jest.fn() };
  const prisma = { session: { findFirst: jest.fn() } };
  let revoked: ((p: { sessionIds: string[] }) => void) | undefined;
  const events = { on: jest.fn((name: string, fn: any) => { if (name === 'sessions.revoked') revoked = fn; return () => undefined; }) };
  const disconnectSockets = jest.fn();
  let gateway: AdminGateway;

  const client = (token = 'tok') => ({
    handshake: { auth: { token } },
    data: {} as any,
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  beforeEach(() => {
    gateway = new AdminGateway(events as any, prisma as any, jwt as any);
    gateway.server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }), in: jest.fn().mockReturnValue({ disconnectSockets }) } as any;
  });
  afterEach(() => jest.clearAllMocks());

  it('rejects the old forged "admin-<userId>" token (no valid signature)', async () => {
    jwt.verify.mockImplementation(() => { throw new Error('jwt malformed'); });
    const c = client('admin-victim-admin-id');
    await gateway.handleConnection(c as any);
    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a valid JWT whose session is revoked, expired, or not an active admin', async () => {
    jwt.verify.mockReturnValue({ sub: 'u1', sid: 's1' });
    prisma.session.findFirst.mockResolvedValue(null);
    const c = client();
    await gateway.handleConnection(c as any);
    expect(c.disconnect).toHaveBeenCalledWith(true);
    expect(c.join).not.toHaveBeenCalled();
    expect(prisma.session.findFirst.mock.calls[0][0].where).toMatchObject({
      revokedAt: null,
      user: { status: 'ACTIVE', type: 'admin' },
    });
  });

  it('rejects an admin user with no roles', async () => {
    jwt.verify.mockReturnValue({ sub: 'a1', sid: 's1' });
    prisma.session.findFirst.mockResolvedValue({ user: { id: 'a1', adminRoles: [] } });
    const c = client();
    await gateway.handleConnection(c as any);
    expect(c.disconnect).toHaveBeenCalled();
    expect(c.join).not.toHaveBeenCalled();
  });

  it('joins only the rooms for the admin\'s roles (+ own session room)', async () => {
    jwt.verify.mockReturnValue({ sub: 'a1', sid: 's1' });
    prisma.session.findFirst.mockResolvedValue({ user: { id: 'a1', adminRoles: ['Verification'] } });
    const c = client();
    await gateway.handleConnection(c as any);
    expect(c.disconnect).not.toHaveBeenCalled();
    expect(c.join).toHaveBeenCalledWith(expect.arrayContaining(['admin:Verification', 'session:s1']));
    const rooms = c.join.mock.calls[0][0] as string[];
    expect(rooms).not.toContain('admin:Safety');
  });

  it('Super Admin joins every admin room', async () => {
    jwt.verify.mockReturnValue({ sub: 'a1', sid: 's1' });
    prisma.session.findFirst.mockResolvedValue({ user: { id: 'a1', adminRoles: ['Super Admin'] } });
    const c = client();
    await gateway.handleConnection(c as any);
    expect(c.join.mock.calls[0][0]).toEqual(expect.arrayContaining(['admin:Verification', 'admin:Operations', 'admin:Safety', 'admin:Support', 'admin:Finance']));
  });

  it('disconnects sockets of a revoked session', () => {
    revoked?.({ sessionIds: ['s1', 's2'] });
    expect(gateway.server.in).toHaveBeenCalledWith('session:s1');
    expect(gateway.server.in).toHaveBeenCalledWith('session:s2');
    expect(disconnectSockets).toHaveBeenCalledTimes(2);
  });
});
