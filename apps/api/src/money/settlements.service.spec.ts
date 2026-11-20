import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';

describe('SettlementsService', () => {
  const tx: any = { settlement: { updateMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() } };
  const prisma: any = { worker: { findUnique: jest.fn() }, settlement: { count: jest.fn(), create: jest.fn(), findMany: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)) };
  const ledger = { post: jest.fn() };
  const countries = { forWorker: jest.fn() };
  const audit = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const events = { emit: jest.fn() };
  const svc = new SettlementsService(prisma, ledger as any, countries as any, audit as any, notifications as any, realtime as any, events as any);
  const dto = { amount: 5000, rail: 'jazzcash', reference: ' TX123 ' };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    countries.forWorker.mockResolvedValue({ currency: 'PKR', settlementRails: [{ id: 'jazzcash' }] });
    prisma.worker.findUnique.mockResolvedValue({ ledgerBalance: 8000, currency: 'PKR' });
    prisma.settlement.count.mockResolvedValue(0);
  });

  describe('report', () => {
    it('refuses an unknown worker, rail, a zero balance, too much, or a second pending payment', async () => {
      prisma.worker.findUnique.mockResolvedValueOnce(null);
      await expect(svc.report('w', dto)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.report('w', { ...dto, rail: 'bitcoin' })).rejects.toMatchObject({ response: { code: 'UNKNOWN_RAIL' } });
      prisma.worker.findUnique.mockResolvedValueOnce({ ledgerBalance: 0 });
      await expect(svc.report('w', dto)).rejects.toMatchObject({ response: { code: 'NOTHING_OWED' } });
      await expect(svc.report('w', { ...dto, amount: 9000 })).rejects.toBeInstanceOf(BadRequestException);
      prisma.settlement.count.mockResolvedValue(1);
      await expect(svc.report('w', dto)).rejects.toMatchObject({ response: { code: 'SETTLEMENT_PENDING' } });
    });

    it('creates a pending settlement in the country currency, audits and tells staff', async () => {
      prisma.settlement.create.mockResolvedValue({ id: 's1', amount: 5000, rail: 'jazzcash' });
      await svc.report('w', dto);
      expect(prisma.settlement.create.mock.calls[0][0].data).toMatchObject({ currency: 'PKR', reference: 'TX123', status: 'PENDING' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'settlement.reported' }));
      expect(events.emit).toHaveBeenCalledWith('admin.settlement_reported', { settlementId: 's1', workerId: 'w' });
    });
  });

  it('lists: own (newest first) and for staff (oldest first, optional status)', async () => {
    await svc.listMine('w'); await svc.listForStaff('PENDING'); await svc.listForStaff();
    expect(prisma.settlement.findMany.mock.calls[0][0].where).toEqual({ workerId: 'w' });
    expect(prisma.settlement.findMany.mock.calls[1][0].where).toEqual({ status: 'PENDING' });
    expect(prisma.settlement.findMany.mock.calls[2][0].where).toEqual({});
  });

  describe('decide', () => {
    const s = { id: 's1', workerId: 'w', amount: 5000, currency: 'PKR', rail: 'jazzcash', reference: 'TX1' };
    it('approve reduces what the worker owes (once) and tells them', async () => {
      tx.settlement.updateMany.mockResolvedValue({ count: 1 });
      tx.settlement.findUniqueOrThrow.mockResolvedValue(s);
      await svc.decide('s1', 'fin', true, ' thanks ');
      expect(ledger.post).toHaveBeenCalledWith(tx, expect.objectContaining({ type: 'COMMISSION_SETTLED', amount: -5000, idempotencyKey: 'settlement:s1' }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'settlement.confirmed' }));
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'settlement.confirmed', userIds: ['w'] });
      expect(realtime.emitToUsers).toHaveBeenCalled();
    });

    it('reject leaves the ledger alone', async () => {
      tx.settlement.updateMany.mockResolvedValue({ count: 1 });
      tx.settlement.findUniqueOrThrow.mockResolvedValue(s);
      await svc.decide('s1', 'fin', false, 'reference not found');
      expect(ledger.post).not.toHaveBeenCalled();
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'settlement.rejected', params: { reason: 'reference not found' } });
    });

    it('a settlement is decided once: 404 if unknown, 409 if already checked', async () => {
      tx.settlement.updateMany.mockResolvedValue({ count: 0 });
      tx.settlement.findUnique.mockResolvedValueOnce(null);
      await expect(svc.decide('x', 'fin', true)).rejects.toBeInstanceOf(NotFoundException);
      tx.settlement.findUnique.mockResolvedValueOnce({ id: 's1' });
      await expect(svc.decide('s1', 'fin', true)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
