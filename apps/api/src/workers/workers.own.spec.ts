import { BadRequestException, NotFoundException } from '@nestjs/common';
import { commissionConfigFor } from '../common/commission';
import { WorkersService } from './workers.service';

/** Going online, profile updates, and the commission figures a worker sees. */
describe('WorkersService (own account)', () => {
  const prisma: any = {
    worker: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    ledgerEntry: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  };
  const svc = new WorkersService(prisma, {} as any, {} as any, {} as any);
  const cfg = commissionConfigFor('PK');
  jest.spyOn(svc, 'findOwn').mockResolvedValue({ id: 'w1' } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ countryCode: 'PK' });
    prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  });

  describe('update', () => {
    const active = { activationStatus: 'ACTIVE', serviceLat: null, serviceLng: null };
    it('404 for an unknown worker', async () => {
      prisma.worker.findUnique.mockResolvedValue(null);
      await expect(svc.update('w1', { bio: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('cannot go online until approved', async () => {
      prisma.worker.findUnique.mockResolvedValue({ ...active, activationStatus: 'PENDING_REVIEW' });
      await expect(svc.update('w1', { isOnline: true } as any)).rejects.toMatchObject({ response: { code: 'WORKER_NOT_ACTIVE' } });
    });
    it('cannot go online while owing more than the hard limit; jobs already booked are unaffected', async () => {
      prisma.worker.findUnique.mockResolvedValue(active);
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -(cfg.hardLimitMinor + 1) } });
      await expect(svc.update('w1', { isOnline: true } as any)).rejects.toMatchObject({ response: { code: 'COMMISSION_CAP_EXCEEDED' } });
      expect(prisma.worker.update).not.toHaveBeenCalled();
    });
    it('owing a little (warning range) still lets them go online', async () => {
      prisma.worker.findUnique.mockResolvedValue(active);
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -(cfg.softLimitMinor + 1) } });
      await expect(svc.update('w1', { isOnline: true } as any)).resolves.toBeDefined();
      expect(prisma.worker.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { isOnline: true } });
    });
    it('needs both coordinates when none are saved yet', async () => {
      prisma.worker.findUnique.mockResolvedValue(active);
      await expect(svc.update('w1', { serviceLat: 24.9 } as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.update('w1', { serviceLat: 24.9, serviceLng: 67.1 } as any)).resolves.toBeDefined();
    });
    it('an hourly model needs a rate (sent now or already saved)', async () => {
      prisma.worker.findUnique.mockResolvedValueOnce(active).mockResolvedValueOnce({ hourlyRate: null });
      await expect(svc.update('w1', { pricingModel: 'HOURLY' } as any)).rejects.toMatchObject({ response: { code: 'HOURLY_RATE_REQUIRED' } });
      prisma.worker.findUnique.mockResolvedValueOnce(active).mockResolvedValueOnce({ hourlyRate: 80000 });
      await expect(svc.update('w1', { pricingModel: 'HOURLY' } as any)).resolves.toBeDefined();
    });
  });

  describe('earnings', () => {
    it('reports what is owed, the limits and the status', async () => {
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -(cfg.softLimitMinor + 100) } });
      prisma.ledgerEntry.count.mockResolvedValue(3);
      prisma.ledgerEntry.findMany
        .mockResolvedValueOnce([{ type: 'COMMISSION_OWED', amount: -300 }, { type: 'COMMISSION_OWED', amount: -200 }, { type: 'COMMISSION_PAID', amount: 500 }])
        .mockResolvedValueOnce([{ id: 'l1' }]);
      const e = await svc.getEarnings('w1');
      expect(e).toMatchObject({ owed: cfg.softLimitMinor + 100, balance: -(cfg.softLimitMinor + 100), currency: 'PKR', status: 'WARN', softLimit: cfg.softLimitMinor, hardLimit: cfg.hardLimitMinor, totalEntries: 3, todayEarnings: 500 });
      expect(e.history).toEqual([{ id: 'l1' }]);
    });
    it('owes nothing when the ledger is empty or positive', async () => {
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 4000 } });
      prisma.ledgerEntry.count.mockResolvedValue(0); prisma.ledgerEntry.findMany.mockResolvedValue([]);
      await expect(svc.getEarnings('w1')).resolves.toMatchObject({ owed: 0, status: 'OK' });
    });
    it('an unknown country falls back to Pakistan rules', async () => {
      prisma.user.findUnique.mockResolvedValue({ countryCode: 'ZZ' });
      prisma.ledgerEntry.count.mockResolvedValue(0); prisma.ledgerEntry.findMany.mockResolvedValue([]);
      await expect(svc.getEarnings('w1')).resolves.toMatchObject({ currency: 'PKR' });
    });
  });

  it('getLedger returns a page and the total', async () => {
    prisma.ledgerEntry.findMany.mockResolvedValue([{ id: 'l1' }]); prisma.ledgerEntry.count.mockResolvedValue(9);
    await expect(svc.getLedger('w1', 5, 10)).resolves.toEqual({ entries: [{ id: 'l1' }], total: 9 });
    expect(prisma.ledgerEntry.findMany.mock.calls[0][0]).toMatchObject({ skip: 5, take: 10, where: { workerId: 'w1' } });
  });

  it('a non-ACTIVE worker may still go offline', async () => {
    prisma.worker.findUnique.mockResolvedValue({ activationStatus: 'SUSPENDED', serviceLat: null, serviceLng: null });
    await expect(svc.update('w1', { isOnline: false } as any)).resolves.toBeDefined();
  });
});
