import { ConflictException, NotFoundException } from '@nestjs/common';
import { DisputesService } from './disputes.service';

describe('DisputesService', () => {
  const prisma: any = { dispute: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
  const access = { requireParticipant: jest.fn() };
  const audit = { record: jest.fn() };
  const events = { emit: jest.fn() };
  const svc = new DisputesService(prisma, access as any, audit as any, events as any);
  const user = { id: 'u1', type: 'customer' };
  beforeEach(() => jest.resetAllMocks());

  it('only a participant can open one', async () => {
    access.requireParticipant.mockRejectedValue(new NotFoundException());
    await expect(svc.createDispute(user, { jobRequestId: 'j1', reason: 'r' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });
  it('refuses a second open report and points at the first', async () => {
    prisma.dispute.findFirst.mockResolvedValue({ id: 'd0' });
    await expect(svc.createDispute(user, { jobRequestId: 'j1', reason: 'r' } as any)).rejects.toMatchObject({ response: { code: 'DISPUTE_EXISTS', details: { disputeId: 'd0' } } });
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });
  it('creates with a default category, audits and alerts admins', async () => {
    prisma.dispute.findFirst.mockResolvedValue(null);
    prisma.dispute.create.mockResolvedValue({ id: 'd1', jobRequestId: 'j1' });
    await svc.createDispute(user, { jobRequestId: 'j1', reason: 'r' } as any);
    expect(prisma.dispute.create.mock.calls[0][0].data).toMatchObject({ category: 'OTHER', raisedById: 'u1', jobRequestId: 'j1' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'dispute.opened' }));
    expect(events.emit).toHaveBeenCalledWith('admin.dispute_opened', { disputeId: 'd1', jobId: 'j1' });
  });
  it('detail: parties see it, admins see any, strangers get 404', async () => {
    prisma.dispute.findFirst.mockResolvedValue(null);
    await expect(svc.getDisputeById('d1', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dispute.findFirst.mock.calls[0][0].where.OR).toHaveLength(3);
    prisma.dispute.findFirst.mockResolvedValue({ id: 'd1' });
    await svc.getDisputeById('d1', { id: 'a', type: 'admin' });
    expect(prisma.dispute.findFirst.mock.calls[1][0].where).toEqual({ id: 'd1' });
  });
  it('lists only my reports; admins list all', async () => {
    await svc.getUserDisputes('u1');
    expect(prisma.dispute.findMany.mock.calls[0][0].where).toEqual({ raisedById: 'u1' });
    await svc.getAllDisputes();
    expect(prisma.dispute.findMany.mock.calls[1][0].take).toBe(200);
  });
  it('resolve: 404 when unknown; stamps who and when only on RESOLVED; audits', async () => {
    prisma.dispute.findUnique.mockResolvedValue(null);
    await expect(svc.updateDisputeStatus('d1', { status: 'RESOLVED' } as any, 'adm')).rejects.toBeInstanceOf(NotFoundException);
    prisma.dispute.findUnique.mockResolvedValue({ status: 'OPEN', resolution: null });
    prisma.dispute.update.mockResolvedValue({ status: 'IN_REVIEW', resolution: null });
    await svc.updateDisputeStatus('d1', { status: 'IN_REVIEW' } as any, 'adm');
    expect(prisma.dispute.update.mock.calls[0][0].data).toMatchObject({ resolvedById: undefined, resolvedAt: undefined });
    prisma.dispute.update.mockResolvedValue({ status: 'RESOLVED', resolution: 'refund' });
    await svc.updateDisputeStatus('d1', { status: 'RESOLVED', resolution: 'refund' } as any, 'adm');
    expect(prisma.dispute.update.mock.calls[1][0].data).toMatchObject({ resolvedById: 'adm', resolution: 'refund' });
    expect(prisma.dispute.update.mock.calls[1][0].data.resolvedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });
});
