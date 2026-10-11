import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChangeOrdersService } from './change-orders.service';

describe('ChangeOrdersService', () => {
  const tx: any = {
    $queryRaw: jest.fn(),
    changeOrder: { count: jest.fn(), create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    jobRequest: { update: jest.fn() },
    jobEvent: { create: jest.fn() },
  };
  const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)), changeOrder: { findMany: jest.fn() } };
  const access = { requireAssignedWorker: jest.fn(), requireParticipant: jest.fn() };
  const audit = { record: jest.fn() };
  const storage = { consume: jest.fn(), signedUrlForKey: jest.fn(async (k: string) => `https://signed/${k}`) };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const svc = new ChangeOrdersService(prisma, access as any, audit as any, storage as any, notifications as any, realtime as any);
  const dto = { jobRequestId: 'j1', reason: 'Pipe cracked behind the wall', addedScope: 'Replace 1 m of pipe', revisedPrice: 250000 };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    access.requireAssignedWorker.mockResolvedValue({ status: 'IN_PROGRESS' });
    tx.$queryRaw.mockResolvedValue([{ agreedAmount: 150000, agreedCurrency: 'PKR', currency: 'USD', title: 'Leaking tap', customerId: 'c1' }]);
    tx.changeOrder.count.mockResolvedValue(0);
    tx.changeOrder.create.mockImplementation(async ({ data }: any) => ({ id: 'co1', ...data }));
    notifications.notify.mockResolvedValue(1);
  });

  it('uses the job\'s currency (never USD by default) and tells the customer the new total', async () => {
    const out: any = await svc.create('w1', dto);
    expect(tx.changeOrder.create.mock.calls[0][0].data).toMatchObject({ currency: 'PKR', revisedPrice: 250000, status: 'PENDING' });
    expect(out.photos).toEqual([]);
    expect(out.mediaKeys).toBeUndefined();
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'change_order.created', userIds: ['c1'], params: { title: 'Leaking tap', price: { minor: 250000, currency: 'PKR' } },
    }));
    expect(tx.jobEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'CHANGE_ORDER_PROPOSED', payload: { from: 150000, to: 250000 } });
  });

  it('only one proposal at a time, under a lock on the job', async () => {
    tx.changeOrder.count.mockResolvedValue(1);
    await expect(svc.create('w1', dto)).rejects.toThrow(ConflictException);
    expect(String(tx.$queryRaw.mock.calls[0][0].join('?'))).toMatch(/FOR UPDATE/);
    expect(tx.changeOrder.create).not.toHaveBeenCalled();
  });

  it('refuses on a job that is not under way, or with the same price', async () => {
    access.requireAssignedWorker.mockResolvedValue({ status: 'AWAITING_CONFIRMATION' });
    await expect(svc.create('w1', dto)).rejects.toThrow(ConflictException);
    access.requireAssignedWorker.mockResolvedValue({ status: 'IN_PROGRESS' });
    await expect(svc.create('w1', { ...dto, revisedPrice: 150000 })).rejects.toThrow(ConflictException);
  });

  it('photos must be the worker\'s own uploads; links are signed, keys never returned', async () => {
    storage.consume.mockResolvedValue(['job-photos/k1.jpg']);
    const out: any = await svc.create('w1', { ...dto, photoUploadIds: ['up1'] });
    expect(storage.consume).toHaveBeenCalledWith('w1', ['up1'], 'JOB_PHOTO', tx);
    expect(out.photos).toEqual(['https://signed/job-photos/k1.jpg']);
  });

  describe('decide', () => {
    const pending = { id: 'co1', jobRequestId: 'j1', revisedPrice: 250000, currency: 'PKR', mediaKeys: [], jobRequest: { id: 'j1', status: 'IN_PROGRESS', agreedAmount: 150000, title: 'Tap', assignedWorkerId: 'w1' } };
    beforeEach(() => {
      tx.changeOrder.findFirst.mockResolvedValue(pending);
      tx.changeOrder.updateMany.mockResolvedValue({ count: 1 });
      tx.changeOrder.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'APPROVED' });
    });

    it('approving makes the new total the agreed price, records from/to, and tells the worker', async () => {
      await svc.updateStatus('co1', 'c1', 'APPROVED');
      expect(tx.jobRequest.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { agreedAmount: 250000, agreedCurrency: 'PKR' } });
      expect(tx.changeOrder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'co1', status: 'PENDING' }, data: { status: 'APPROVED', previousPrice: 150000 } });
      expect(tx.jobEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'CHANGE_ORDER_APPROVED', payload: { from: 150000, to: 250000 } });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'change_order.approved', userIds: ['w1'] }));
    });

    it('declining keeps the price', async () => {
      tx.changeOrder.findUniqueOrThrow.mockResolvedValue({ ...pending, status: 'REJECTED' });
      await svc.updateStatus('co1', 'c1', 'REJECTED');
      expect(tx.jobRequest.update).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'change_order.declined' }));
    });

    it('decided once only; not on a finished job; not someone else\'s', async () => {
      tx.changeOrder.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.updateStatus('co1', 'c1', 'APPROVED')).rejects.toThrow(ConflictException);
      tx.changeOrder.findFirst.mockResolvedValue({ ...pending, jobRequest: { ...pending.jobRequest, status: 'COMPLETED' } });
      await expect(svc.updateStatus('co1', 'c1', 'APPROVED')).rejects.toThrow(ConflictException);
      tx.changeOrder.findFirst.mockResolvedValue(null);
      await expect(svc.updateStatus('co1', 'intruder', 'APPROVED')).rejects.toThrow(NotFoundException);
    });
  });
});
