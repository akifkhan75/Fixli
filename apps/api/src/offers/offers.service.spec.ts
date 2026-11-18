import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OffersService } from './offers.service';

describe('OffersService', () => {
  const tx: any = {
    $queryRaw: jest.fn(),
    jobRequest: { findFirst: jest.fn(), updateMany: jest.fn() },
    offer: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    jobEvent: { create: jest.fn() },
    conversation: { create: jest.fn() },
  };
  const prisma: any = {
    worker: { findUnique: jest.fn() },
    jobMatch: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    offer: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    jobEvent: { create: jest.fn() },
    jobRequest: { findUnique: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    review: { groupBy: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const config = { get: jest.fn((k: string) => ({ OFFER_TTL_MINUTES: 10, MAX_OFFERS_SHOWN: 2 } as any)[k]) };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const svc = new OffersService(prisma, config as any, notifications as any, realtime as any);

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockImplementation((k: string) => ({ OFFER_TTL_MINUTES: 10, MAX_OFFERS_SHOWN: 2 } as any)[k]);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
  });

  const openMatch = (over: any = {}) => ({ declinedAt: null, jobRequest: { id: 'j1', status: 'MATCHES_FOUND', customerId: 'c1', assignedWorkerId: null }, ...over });
  const activeWorker = { activationStatus: 'ACTIVE', currency: 'PKR' };

  describe('submit', () => {
    it('404 when the worker was never matched to the request', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker); prisma.jobMatch.findUnique.mockResolvedValue(null);
      await expect(svc.submit('w1', 'j1', { amount: 1000 } as any)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('403 for a worker who is not approved', async () => {
      prisma.worker.findUnique.mockResolvedValue({ activationStatus: 'PENDING_REVIEW', currency: 'PKR' }); prisma.jobMatch.findUnique.mockResolvedValue(openMatch());
      await expect(svc.submit('w1', 'j1', { amount: 1000 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('409 when they already said not interested', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker); prisma.jobMatch.findUnique.mockResolvedValue(openMatch({ declinedAt: new Date() }));
      await expect(svc.submit('w1', 'j1', { amount: 1000 } as any)).rejects.toMatchObject({ response: { code: 'ALREADY_DECLINED' } });
    });
    it('409 when the request is closed or already assigned', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker);
      prisma.jobMatch.findUnique.mockResolvedValue(openMatch({ jobRequest: { id: 'j1', status: 'ACCEPTED', customerId: 'c1', assignedWorkerId: 'w2' } }));
      await expect(svc.submit('w1', 'j1', { amount: 1000 } as any)).rejects.toMatchObject({ response: { code: 'REQUEST_CLOSED' } });
    });
    it('409 when the customer already decided on this worker\'s price', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker); prisma.jobMatch.findUnique.mockResolvedValue(openMatch());
      prisma.offer.findUnique.mockResolvedValue({ id: 'o1', status: 'REJECTED' });
      await expect(svc.submit('w1', 'j1', { amount: 1000 } as any)).rejects.toMatchObject({ response: { code: 'OFFER_CLOSED' } });
    });
    it('first price: creates it in the worker\'s currency, logs it, tells the customer and notifies them', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker); prisma.jobMatch.findUnique.mockResolvedValue(openMatch());
      prisma.offer.findUnique.mockResolvedValue(null);
      tx.offer.create.mockResolvedValue({ id: 'o1', amount: 5000, currency: 'PKR' });
      prisma.user.findUnique.mockResolvedValue({ name: 'Bilal' });
      const o = await svc.submit('w1', 'j1', { amount: 5000, etaMinutes: 30, note: ' soon ' } as any);
      expect(o.id).toBe('o1');
      expect(tx.offer.create.mock.calls[0][0].data).toMatchObject({ amount: 5000, currency: 'PKR', etaMinutes: 30, note: 'soon', status: 'PENDING', jobRequestId: 'j1', workerId: 'w1' });
      expect(tx.jobEvent.create.mock.calls[0][0].data.type).toBe('OFFER_RECEIVED');
      expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1'], 'offers.updated', { jobId: 'j1' });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer.received', userIds: ['c1'], params: expect.objectContaining({ worker: 'Bilal' }) }));
    });
    it('revising a still-pending price updates it quietly (no new notification)', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker); prisma.jobMatch.findUnique.mockResolvedValue(openMatch());
      prisma.offer.findUnique.mockResolvedValue({ id: 'o1', status: 'PENDING' });
      tx.offer.update.mockResolvedValue({ id: 'o1', amount: 4000, currency: 'PKR' });
      await svc.submit('w1', 'j1', { amount: 4000 } as any);
      expect(tx.jobEvent.create.mock.calls[0][0].data.type).toBe('OFFER_REVISED');
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(realtime.emitToUsers).toHaveBeenCalled();
    });
    it('a fresh price after the old one expired is news again', async () => {
      prisma.worker.findUnique.mockResolvedValue(activeWorker); prisma.jobMatch.findUnique.mockResolvedValue(openMatch());
      prisma.offer.findUnique.mockResolvedValue({ id: 'o1', status: 'EXPIRED' });
      tx.offer.update.mockResolvedValue({ id: 'o1', amount: 4000, currency: 'PKR' });
      prisma.user.findUnique.mockResolvedValue(null);
      await svc.submit('w1', 'j1', { amount: 4000 } as any);
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ worker: 'A professional' }) }));
    });
  });

  describe('withdraw / notInterested', () => {
    it('withdraw: 404 with no open price', async () => {
      prisma.offer.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.withdraw('w1', 'j1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('withdraw: marks withdrawn, logs and tells the customer', async () => {
      prisma.offer.updateMany.mockResolvedValue({ count: 1 }); prisma.jobRequest.findUnique.mockResolvedValue({ customerId: 'c1' });
      await expect(svc.withdraw('w1', 'j1')).resolves.toEqual({ success: true });
      expect(prisma.jobEvent.create.mock.calls[0][0].data.type).toBe('OFFER_WITHDRAWN');
      expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1'], 'offers.updated', { jobId: 'j1' });
    });
    it('notInterested: 404 when not matched', async () => {
      prisma.jobMatch.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.notInterested('w1', 'j1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('notInterested: withdraws a pending price and tells the customer only when there was one', async () => {
      prisma.jobMatch.updateMany.mockResolvedValue({ count: 1 }); prisma.offer.updateMany.mockResolvedValue({ count: 0 });
      await svc.notInterested('w1', 'j1');
      expect(realtime.emitToUsers).not.toHaveBeenCalled();
      prisma.offer.updateMany.mockResolvedValue({ count: 1 }); prisma.jobRequest.findUnique.mockResolvedValue({ customerId: 'c1' });
      await svc.notInterested('w1', 'j1');
      expect(realtime.emitToUsers).toHaveBeenCalledTimes(1);
    });
  });

  it('feed: flattens each match with the worker\'s own offer or null', async () => {
    prisma.jobMatch.findMany.mockResolvedValue([
      { distanceKm: 2, notifiedAt: 'n1', jobRequest: { id: 'a', offers: [{ id: 'o' }] } },
      { distanceKm: 5, notifiedAt: 'n2', jobRequest: { id: 'b', offers: [] } },
    ]);
    const feed = await svc.feed('w1');
    expect(feed).toEqual([
      { id: 'a', distanceKm: 2, notifiedAt: 'n1', myOffer: { id: 'o' } },
      { id: 'b', distanceKm: 5, notifiedAt: 'n2', myOffer: null },
    ]);
  });

  describe('listForCustomer', () => {
    const offer = (id: string, workerId: string, amount: number, score: number, hide = false) => ({
      id, amount, currency: 'PKR', etaMinutes: 20, note: null, expiresAt: new Date(), createdAt: new Date(),
      worker: { id: workerId, rating: 4.5, isVerified: true, experienceYears: 3, hidePhotoUntilBooked: hide, user: { name: workerId, profileImageUrl: 'p.jpg' }, matches: [{ score, distanceKm: 1.5 }], _count: { assignedJobs: 7 } },
    });
    it('404 for someone else\'s job', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(null);
      await expect(svc.listForCustomer('c1', 'j1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('best score first, cheaper breaks ties, capped at MAX_OFFERS_SHOWN, photo hidden when asked', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue({ id: 'j1' });
      prisma.offer.findMany.mockResolvedValue([offer('o1', 'wa', 9000, 1), offer('o2', 'wb', 5000, 5, true), offer('o3', 'wc', 4000, 5), offer('o4', 'wd', 1000, 0.1)]);
      prisma.review.groupBy.mockResolvedValue([{ targetId: 'wb', _count: 12 }]);
      const out = await svc.listForCustomer('c1', 'j1');
      expect(out.map((o) => o.id)).toEqual(['o3', 'o2']);
      expect(out[1].worker).toMatchObject({ profileImageUrl: null, ratingCount: 12, jobsCompleted: 7, distanceKm: 1.5 });
      expect(out[0].worker.profileImageUrl).toBe('p.jpg');
      expect(out[0]).not.toHaveProperty('score');
    });
  });

  describe('accept', () => {
    const pending = (over: any = {}) => ({
      id: 'o1', workerId: 'w1', amount: 5000, currency: 'PKR', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000),
      jobRequest: { id: 'j1', customerId: 'c1', status: 'MATCHES_FOUND', title: 'Tap', scheduledFrom: null, scheduledTo: null }, ...over,
    });
    it('404 for another customer\'s offer', async () => {
      prisma.offer.findUnique.mockResolvedValue(pending({ jobRequest: { ...pending().jobRequest, customerId: 'zz' } }));
      await expect(svc.accept('c1', 'o1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it.each([
      ['not pending', { status: 'WITHDRAWN' }, 'OFFER_NOT_AVAILABLE'],
      ['expired', { expiresAt: new Date(Date.now() - 1000) }, 'OFFER_EXPIRED'],
      ['job already closed', { jobRequest: { id: 'j1', customerId: 'c1', status: 'ACCEPTED' } }, 'REQUEST_CLOSED'],
    ])('409 when %s', async (_n, over, expected) => {
      prisma.offer.findUnique.mockResolvedValue(pending(over));
      await expect(svc.accept('c1', 'o1')).rejects.toMatchObject({ response: { code: expected } });
    });
    it('409 WORKER_BUSY when the worker has an overlapping booking', async () => {
      prisma.offer.findUnique.mockResolvedValue(pending()); tx.jobRequest.findFirst.mockResolvedValue({ id: 'other' });
      await expect(svc.accept('c1', 'o1')).rejects.toMatchObject({ response: { code: 'WORKER_BUSY' } });
      expect(tx.jobRequest.updateMany).not.toHaveBeenCalled();
    });
    it('409 when the job changed under us (conditional update matched nothing)', async () => {
      prisma.offer.findUnique.mockResolvedValue(pending()); tx.jobRequest.findFirst.mockResolvedValue(null); tx.jobRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.accept('c1', 'o1')).rejects.toMatchObject({ response: { code: 'REQUEST_CLOSED' } });
    });
    it('409 when the offer was taken or expired during the transaction', async () => {
      prisma.offer.findUnique.mockResolvedValue(pending()); tx.jobRequest.findFirst.mockResolvedValue(null);
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 }); tx.offer.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.accept('c1', 'o1')).rejects.toBeInstanceOf(ConflictException);
    });
    it('books the job, rejects the others, opens the chat and notifies winner and losers', async () => {
      prisma.offer.findUnique.mockResolvedValue(pending()); tx.jobRequest.findFirst.mockResolvedValue(null);
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 }); tx.offer.updateMany.mockResolvedValue({ count: 1 });
      tx.offer.findMany.mockResolvedValue([{ id: 'o2', workerId: 'w2' }, { id: 'o3', workerId: 'w3' }]);
      prisma.jobMatch.findMany.mockResolvedValue([{ workerId: 'w1' }, { workerId: 'w2' }, { workerId: 'w3' }]);
      const r = await svc.accept('c1', 'o1');
      expect(r).toEqual({ jobId: 'j1', status: 'ACCEPTED', workerId: 'w1', amount: 5000, currency: 'PKR' });
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'ACCEPTED', assignedWorkerId: 'w1', agreedAmount: 5000, acceptedOfferId: 'o1' });
      expect(tx.offer.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: ['o2', 'o3'] } }, data: { status: 'REJECTED' } });
      expect(tx.conversation.create).toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledTimes(3);
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'offer.accepted', userIds: ['w1'] });
      expect(realtime.emitToUsers).toHaveBeenCalledWith(['w1', 'w2', 'w3'], 'feed.updated', { jobId: 'j1' });
    });
  });
});
