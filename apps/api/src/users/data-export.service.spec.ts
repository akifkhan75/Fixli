import { NotFoundException } from '@nestjs/common';
import { DataExportService } from './data-export.service';

jest.mock('../common/crypto/field-crypto', () => ({ maskIdNumber: (v: string | null) => (v ? 'MASKED' : null) }));

describe('DataExportService', () => {
  const m = (v: any = []) => ({ findMany: jest.fn().mockResolvedValue(v), findUnique: jest.fn().mockResolvedValue(null) });
  const prisma: any = {
    user: { findUnique: jest.fn() },
    address: m(), trustedContact: m(), favoriteWorker: m([{ createdAt: 'd', worker: { user: { name: 'Bilal' } } }]),
    jobRequest: m([{ id: 'j1', customerId: 'u1', assignedWorkerId: 'w1', description: 'tap' }, { id: 'j2', customerId: 'c2', assignedWorkerId: 'u1', description: 'pipe' }]),
    message: m(), review: m(), dispute: m(), incident: m(), notification: m(), session: m(), payment: m(), project: m(), projectBid: m(),
    worker: { findUnique: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const svc = new DataExportService(prisma, audit as any);
  beforeEach(() => { jest.clearAllMocks(); prisma.worker.findUnique.mockResolvedValue(null); });

  it('404 for an unknown account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.export('u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never asks for the password hash, and scopes every query to the requester', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Ali' });
    await svc.export('u1');
    expect(JSON.stringify(prisma.user.findUnique.mock.calls[0][0].select)).not.toContain('password');
    expect(JSON.stringify(prisma.message.findMany.mock.calls[0][0].where)).toContain('"senderId":"u1"');
    expect(JSON.stringify(prisma.address.findMany.mock.calls[0][0].where)).toContain('"userId":"u1"');
    expect(JSON.stringify(prisma.jobRequest.findMany.mock.calls[0][0].where)).toContain('u1');
    // The other party on a job is never selected, only the requester's own role is reported.
    const sel = prisma.jobRequest.findMany.mock.calls[0][0].select;
    expect(Object.keys(sel)).not.toContain('customerName');
  });

  it('reports which side the person was on, hides the other party and names saved workers by name only', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Ali' });
    const r = await svc.export('u1');
    expect(r.jobs.map((j: any) => j.yourRole)).toEqual(['customer', 'professional']);
    expect(JSON.stringify(r.jobs)).not.toContain('c2');
    expect(r.savedWorkers).toEqual([{ name: 'Bilal', savedAt: 'd' }]);
  });

  it('a professional gets their profile with the ID number masked, never the stored value', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Ali' });
    prisma.worker.findUnique.mockResolvedValue({ bio: 'x', services: [{ category: { name: 'PLUMBING' } }], verifications: [{ type: 'ID', status: 'APPROVED', reference: 'v1:secret' }] });
    const r: any = await svc.export('u1');
    expect(r.professionalProfile.services).toEqual(['PLUMBING']);
    expect(r.professionalProfile.verifications[0]).toMatchObject({ idNumberMasked: 'MASKED' });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('records that an export happened', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await svc.export('u1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'u1', action: 'privacy.data_exported' }));
  });
});
