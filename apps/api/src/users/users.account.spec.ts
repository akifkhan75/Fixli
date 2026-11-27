import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

describe('UsersService: account deletion and favourites', () => {
  const tx: any = {
    jobRequest: { findMany: jest.fn(), update: jest.fn() }, jobEvent: { create: jest.fn() }, offer: { updateMany: jest.fn() },
    address: { deleteMany: jest.fn() }, trustedContact: { deleteMany: jest.fn() }, favoriteWorker: { deleteMany: jest.fn() },
    portfolioItem: { deleteMany: jest.fn() }, worker: { update: jest.fn() }, verificationCase: { updateMany: jest.fn() }, user: { update: jest.fn() },
    projectBid: { updateMany: jest.fn() }, projectInvite: { deleteMany: jest.fn() }, project: { updateMany: jest.fn() },
  };
  const prisma: any = {
    user: { findUnique: jest.fn() }, jobRequest: { count: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)),
    favoriteWorker: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() }, worker: { findFirst: jest.fn() },
    project: { count: jest.fn(), findMany: jest.fn() }, projectPayment: { count: jest.fn() },
  };
  const storage = { deleteOwned: jest.fn(), removeKeys: jest.fn() };
  const sessions = { revokeAllExcept: jest.fn() };
  const audit = { record: jest.fn() };
  const svc = new UsersService(prisma, storage as any, sessions as any, audit as any);
  let hash: string;
  beforeAll(async () => { hash = await bcrypt.hash('right-Pass-1', 4); });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    prisma.jobRequest.count.mockResolvedValue(0);
    tx.jobRequest.findMany.mockResolvedValue([]);
    prisma.project.count.mockResolvedValue(0);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.projectPayment.count.mockResolvedValue(0);
  });
  const account = (over: any = {}) => ({ id: 'u1', password: hash, type: 'customer', status: 'ACTIVE', worker: null, ...over });

  describe('deleteMe', () => {
    it('unknown or already deleted accounts are 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.deleteMe('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
      prisma.user.findUnique.mockResolvedValue(account({ status: 'DELETED' }));
      await expect(svc.deleteMe('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('needs the right password and changes nothing without it', async () => {
      prisma.user.findUnique.mockResolvedValue(account());
      await expect(svc.deleteMe('u1', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is refused during an active job or while commission is owed', async () => {
      prisma.user.findUnique.mockResolvedValue(account());
      prisma.jobRequest.count.mockResolvedValue(1);
      await expect(svc.deleteMe('u1', 'right-Pass-1')).rejects.toMatchObject({ response: { code: 'ACTIVE_JOB' } });
      prisma.jobRequest.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(account({ type: 'worker', worker: { ledgerBalance: 500 } }));
      await expect(svc.deleteMe('u1', 'right-Pass-1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is refused while a project is running, money is held, or Fixli owes the professional', async () => {
      prisma.user.findUnique.mockResolvedValue(account());
      prisma.project.count.mockResolvedValue(1);
      await expect(svc.deleteMe('u1', 'right-Pass-1')).rejects.toMatchObject({ response: { code: 'ACTIVE_JOB' } });
      prisma.project.count.mockResolvedValue(0);
      prisma.projectPayment.count.mockResolvedValue(1);
      await expect(svc.deleteMe('u1', 'right-Pass-1')).rejects.toMatchObject({ response: { code: 'MONEY_PENDING' } });
      prisma.projectPayment.count.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(account({ type: 'worker', worker: { ledgerBalance: -500 } }));
      await expect(svc.deleteMe('u1', 'right-Pass-1')).rejects.toMatchObject({ response: { code: 'MONEY_PENDING' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('erases project descriptions, addresses and files', async () => {
      prisma.user.findUnique.mockResolvedValue(account());
      prisma.project.findMany.mockResolvedValue([{ photoKeys: ['p1', 'p2'], audioKey: 'a1' }]);
      await svc.deleteMe('u1', 'right-Pass-1');
      expect(tx.project.updateMany.mock.calls[1][0].data).toMatchObject({ description: '', location: null, latitude: null, photoKeys: [], audioKey: null });
      expect(storage.removeKeys).toHaveBeenCalledWith(['p1', 'p2', 'a1']);
    });

    it('a customer: cancels open requests, erases personal data, signs out, audits', async () => {
      prisma.user.findUnique.mockResolvedValue(account());
      tx.jobRequest.findMany.mockResolvedValue([{ id: 'j1', status: 'CREATED' }]);
      expect(await svc.deleteMe('u1', 'right-Pass-1')).toEqual({ success: true });
      expect(tx.jobRequest.update.mock.calls[0][0].data.status).toBe('CANCELLED');
      expect(tx.jobEvent.create).toHaveBeenCalled();
      const data = tx.user.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'DELETED', name: 'Deleted user', phone: null, email: null, profileImageUrl: null });
      expect(data.password).not.toBe(hash);
      expect(tx.worker.update).not.toHaveBeenCalled();
      expect(storage.deleteOwned).toHaveBeenCalledWith('u1', ['VERIFICATION', 'AVATAR', 'PORTFOLIO']);
      expect(sessions.revokeAllExcept).toHaveBeenCalledWith('u1');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.deleted' }));
    });

    it('a worker: goes offline, loses portfolio and ID number, pending prices withdrawn', async () => {
      prisma.user.findUnique.mockResolvedValue(account({ type: 'worker', worker: { ledgerBalance: 0 } }));
      await svc.deleteMe('u1', 'right-Pass-1');
      expect(tx.offer.updateMany.mock.calls[0][0]).toMatchObject({ where: { workerId: 'u1', status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
      expect(tx.portfolioItem.deleteMany).toHaveBeenCalled();
      expect(tx.worker.update.mock.calls[0][0].data).toEqual({ isOnline: false, bio: null, businessName: null, teamSize: null });
      expect(tx.verificationCase.updateMany.mock.calls[0][0].data).toEqual({ documentKeys: [], reference: null });
    });
  });

  describe('favourites', () => {
    it('list, add (active professionals only, idempotent) and remove', async () => {
      await svc.getFavorites('c1');
      expect(prisma.favoriteWorker.findMany.mock.calls[0][0].where).toEqual({ customerId: 'c1' });
      prisma.worker.findFirst.mockResolvedValueOnce(null);
      await expect(svc.addFavorite('c1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
      prisma.worker.findFirst.mockResolvedValueOnce({ id: 'w1' });
      expect(await svc.addFavorite('c1', 'w1')).toEqual({ success: true });
      expect(prisma.favoriteWorker.upsert.mock.calls[0][0].update).toEqual({});
      expect(await svc.removeFavorite('c1', 'w1')).toEqual({ success: true });
    });
  });

  it('findAll is capped and never includes secrets', async () => {
    prisma.user.findMany = jest.fn().mockResolvedValue([]);
    await svc.findAll();
    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args.take).toBe(200);
    expect(JSON.stringify(args.select)).not.toMatch(/password/);
  });
});
