import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AccountDeletionService, DELETED_NAME } from './account-deletion.service';

const model = () => ({ findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), updateMany: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) });

function build(user: any = {}) {
  const tx: any = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ profileImageUrl: 'avatars/a.jpg', type: 'worker' }), update: jest.fn() },
    upload: model(), jobMedia: model(), message: model(), jobAiAnalysis: model(), jobRequest: model(), review: model(), incident: model(),
    address: model(), trustedContact: model(), favoriteWorker: model(), notification: model(), block: model(), session: model(),
    offer: model(), portfolioItem: model(), verificationCase: model(), workingHours: model(), workerService: model(), worker: model(),
  };
  tx.upload.findMany.mockResolvedValue([{ key: 'u/1.jpg' }]);
  tx.jobMedia.findMany.mockResolvedValue([{ storageKey: 'job/1.jpg' }]);
  tx.portfolioItem.findMany.mockResolvedValue([{ photoKeys: ['p/1.jpg'] }]);
  tx.verificationCase.findMany.mockResolvedValue([{ documentKeys: ['id/front.jpg', 'id/back.jpg'] }]);
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', type: 'worker', status: 'ACTIVE', password: bcrypt.hashSync('right-pass', 4), ...user }) },
    jobRequest: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    payment: { count: jest.fn().mockResolvedValue(0) },
    dispute: { count: jest.fn().mockResolvedValue(0) },
    ledgerEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const storage = { removeKeys: jest.fn().mockResolvedValue({ removed: 5, failed: 0 }) };
  const sessions = { revokeAllExcept: jest.fn() };
  const jobs = { cancel: jest.fn() };
  const audit = { record: jest.fn() };
  return { svc: new AccountDeletionService(prisma, storage as any, sessions as any, jobs as any, audit as any), prisma, tx, storage, sessions, jobs, audit };
}

describe('AccountDeletionService', () => {
  it('needs the right password (a stolen session alone cannot delete)', async () => {
    const { svc, sessions } = build();
    await expect(svc.deleteAccount('u1', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.revokeAllExcept).not.toHaveBeenCalled();
  });

  it('refuses staff accounts', async () => {
    const { svc } = build({ type: 'admin' });
    await expect(svc.deleteAccount('u1', 'right-pass')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is idempotent for an already deleted account', async () => {
    const { svc, tx } = build({ status: 'DELETED' });
    await expect(svc.deleteAccount('u1', 'whatever')).resolves.toEqual({ success: true });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it.each([
    ['JOB_IN_PROGRESS', (p: any) => p.jobRequest.count.mockResolvedValue(1)],
    ['PAYMENT_PENDING', (p: any) => p.payment.count.mockResolvedValue(1)],
    ['DISPUTE_OPEN', (p: any) => p.dispute.count.mockResolvedValue(1)],
    ['COMMISSION_OWED', (p: any) => p.ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: -5000 } })],
  ])('is blocked by %s and changes nothing', async (reason, arrange) => {
    const { svc, prisma, sessions, tx, storage } = build();
    arrange(prisma);
    const err: any = await svc.deleteAccount('u1', 'right-pass').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.response).toMatchObject({ code: 'DELETION_BLOCKED' });
    expect(err.response.details).toContain(reason);
    expect(sessions.revokeAllExcept).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(storage.removeKeys).not.toHaveBeenCalled();
  });

  it('cancels not-started jobs on the user\'s behalf, signs out everywhere, erases, then deletes files', async () => {
    const { svc, prisma, jobs, sessions, tx, storage, audit } = build();
    prisma.jobRequest.findMany.mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
    await expect(svc.deleteAccount('u1', 'right-pass')).resolves.toEqual({ success: true });

    expect(jobs.cancel).toHaveBeenCalledTimes(2);
    expect(jobs.cancel.mock.calls[0][2]).toMatchObject({ reason: 'OTHER' });
    expect(sessions.revokeAllExcept).toHaveBeenCalledWith('u1');

    // personal data is gone
    expect(tx.address.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.trustedContact.deleteMany).toHaveBeenCalled();
    expect(tx.verificationCase.deleteMany).toHaveBeenCalledWith({ where: { workerId: 'u1' } }); // includes the encrypted ID number
    expect(tx.portfolioItem.deleteMany).toHaveBeenCalled();
    expect(tx.session.deleteMany).toHaveBeenCalled();
    expect(tx.message.updateMany.mock.calls[0][0].data).toEqual({ text: '[removed]', imageKey: null });
    expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ customerName: DELETED_NAME, location: null, latitude: null, longitude: null });
    expect(tx.worker.update.mock.calls[0][0].data).toMatchObject({ isOnline: false, bio: null, serviceLat: null, activationStatus: 'INACTIVE' });
    expect(tx.offer.updateMany.mock.calls[0][0]).toMatchObject({ data: { status: 'WITHDRAWN' } });

    // the account row is anonymised with an unusable password
    const data = tx.user.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'DELETED', name: DELETED_NAME, email: null, phone: 'deleted-u1', profileImageUrl: null, totpSecret: null });
    expect(bcrypt.compareSync('right-pass', data.password)).toBe(false);

    // files: avatar, uploads, job media, portfolio, ID documents (each once), AFTER the transaction
    const keys = storage.removeKeys.mock.calls[0][0].sort();
    expect(keys).toEqual(['avatars/a.jpg', 'id/back.jpg', 'id/front.jpg', 'job/1.jpg', 'p/1.jpg', 'u/1.jpg']);
    expect(audit.record.mock.calls[0][0]).toMatchObject({ action: 'account.deleted', entityId: 'u1' });
  });

  it('a job that fails to cancel does not stop the erasure when nothing is blocking', async () => {
    const { svc, prisma, jobs, tx } = build();
    prisma.jobRequest.findMany.mockResolvedValue([{ id: 'j1' }]);
    jobs.cancel.mockRejectedValue(new Error('already cancelled'));
    await expect(svc.deleteAccount('u1', 'right-pass')).resolves.toEqual({ success: true });
    expect(tx.user.update).toHaveBeenCalled();
  });
});
