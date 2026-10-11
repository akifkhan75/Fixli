import { NotificationService } from './notifications.service';
import { render } from './templates';

describe('NotificationService', () => {
  const prisma: any = {
    user: { findMany: jest.fn() },
    notification: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    session: { findMany: jest.fn(), update: jest.fn() },
  };
  const realtime = { emitToUsers: jest.fn() };
  const push = { name: 'fake', send: jest.fn() };
  const svc = new NotificationService(prisma, realtime as any, push as any);
  const input = {
    type: 'offer.received' as const, userIds: ['c1', 'c1'], eventKey: 'offer.received:o1:1',
    params: { worker: 'Bilal', price: { minor: 150000, currency: 'PKR' } }, data: { url: '/(customer)/job/j1', jobId: 'j1' },
  };

  beforeEach(() => {
    prisma.user.findMany.mockResolvedValue([{ id: 'c1', locale: 'en' }]);
    prisma.notification.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'n1', userId: data.userId, title: data.title, body: data.body, createdAt: new Date() }));
    prisma.session.findMany.mockResolvedValue([{ id: 's1', userId: 'c1', pushToken: 'ExponentPushToken[a]' }, { id: 's2', userId: 'c1', pushToken: 'ExponentPushToken[b]' }]);
    push.send.mockResolvedValue([{ ok: true }, { ok: false, error: 'DeviceNotRegistered', deadToken: true }]);
  });
  afterEach(() => jest.resetAllMocks());

  it('stores once, tells the open app, and pushes to every signed-in device', async () => {
    await expect(svc.notify(input)).resolves.toBe(1);
    await svc.idle();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1); // duplicate ids collapsed
    expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({ userId: 'c1', eventKey: 'offer.received:o1:1', title: 'You got a price' });
    expect(prisma.notification.create.mock.calls[0][0].data.body).toMatch(/Bilal can do it for .*1,500/);
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1'], 'notification.created', expect.objectContaining({ id: 'n1', data: input.data }));
    expect(push.send.mock.calls[0][0].map((m: any) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
    expect(push.send.mock.calls[0][0][0].data).toMatchObject({ url: '/(customer)/job/j1', notificationId: 'n1' });
  });

  it('forgets a token the phone no longer accepts', async () => {
    await svc.notify(input);
    await svc.idle();
    expect(prisma.session.update).toHaveBeenCalledWith({ where: { id: 's2' }, data: { pushToken: null } });
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { pushedAt: expect.any(Date) } });
  });

  it('the same event twice is silent the second time (no live event, no push)', async () => {
    prisma.notification.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(svc.notify(input)).resolves.toBe(0);
    await svc.idle();
    expect(realtime.emitToUsers).not.toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('a push outage never fails the action that caused it', async () => {
    push.send.mockRejectedValue(new Error('exp.host down'));
    await expect(svc.notify(input)).resolves.toBe(1);
    await expect(svc.idle()).resolves.toBeUndefined();
  });

  it('suspended or unknown users are not notified', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await expect(svc.notify(input)).resolves.toBe(0);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['c1'] }, status: 'ACTIVE' });
  });

  it('push: false stores and sends live but does not buzz the phone', async () => {
    await svc.notify({ ...input, push: false });
    await svc.idle();
    expect(push.send).not.toHaveBeenCalled();
    expect(realtime.emitToUsers).toHaveBeenCalled();
  });

  it('marks only the caller\'s own notifications read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });
    await svc.markRead('u1', ['n1', 'n2']);
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', readAt: null, id: { in: ['n1', 'n2'] } });
    await svc.markRead('u1');
    expect(prisma.notification.updateMany.mock.calls[1][0].where).toEqual({ userId: 'u1', readAt: null });
  });

  it('pages with a cursor', async () => {
    prisma.notification.findMany.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ id: `n${i}` })));
    await expect(svc.list('u1', { limit: 2 })).resolves.toEqual({ items: [{ id: 'n0' }, { id: 'n1' }], nextCursor: 'n1' });
  });
});

describe('notification templates', () => {
  it('speak the recipient\'s language, money included', () => {
    const ur = render('offer.received', 'ur', { worker: 'بلال', price: { minor: 150000, currency: 'PKR' } });
    expect(ur.title).toBe('آپ کو قیمت ملی');
    expect(ur.body).toContain('بلال');
    expect(render('verification.needs_fix', 'ar', { doc: 'SELFIE', reason: 'Blurry' }).body).toContain('الصورة الشخصية');
    expect(render('job.accepted', 'fr', { worker: 'Ali', title: 'Tap' }).title).toBe('Ali accepted'); // unknown -> English
  });

  it('never exceed the push size limits', () => {
    const r = render('job.request', 'en', { title: 'x'.repeat(500) });
    expect(r.body.length).toBeLessThanOrEqual(240);
  });
});
