import { BadRequestException } from '@nestjs/common';
import { SafetyService, SOS_CATEGORY } from './safety.service';

function build(smsDelivered = true, configured = true) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'PK', name: 'Sana' }) },
    incident: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'i1', ...data })),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    serviceCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-plumbing' }) },
    trustedContact: { findMany: jest.fn().mockResolvedValue([{ name: 'Ali', phone: '+923001112223' }, { name: 'Bo', phone: '+923004445556' }]), count: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  };
  const jobs = { create: jest.fn().mockResolvedValue({ id: 'job1' }) };
  const events = { emit: jest.fn() };
  const audit = { record: jest.fn() };
  const sms = { configured, send: jest.fn().mockResolvedValue({ delivered: smsDelivered }) };
  return { svc: new SafetyService(prisma, jobs as any, events as any, audit as any, sms as any), prisma, jobs, events, sms };
}

describe('SafetyService', () => {
  it('emergency numbers come from shared country config, not hard-coded 115/16', async () => {
    const { svc } = build();
    const r = await svc.getEmergencyNumbers('u1');
    expect(r.country).toBe('PK');
    expect(r.numbers).toEqual([{ label: 'Police', number: '15' }, { label: 'Rescue', number: '1122' }]);
    expect(r.disclaimer).toMatch(/does NOT replace/);
  });

  describe('life-threatening', () => {
    it('NEVER creates a job; alerts trusted contacts; returns the numbers; says nothing about authorities', async () => {
      const { svc, jobs, sms } = build();
      const r = await svc.reportIncident('u1', 'customer', { type: 'SOS', severity: 'LIFE_THREATENING', latitude: 24.9, longitude: 67.1 });
      expect(jobs.create).not.toHaveBeenCalled();
      expect(sms.send).toHaveBeenCalledTimes(2);
      expect(sms.send.mock.calls[0][1]).toMatch(/maps\.google\.com\/\?q=24\.9,67\.1/);
      expect(sms.send.mock.calls[0][1]).toMatch(/not contacted the authorities/);
      expect(r.jobId).toBeNull();
      expect(r.emergencyNumbers.length).toBeGreaterThan(0);
      expect(r.trustedContacts).toEqual({ total: 2, notified: 2, smsConfigured: true });
    });
    it('is honest when no SMS provider is configured: notified = 0', async () => {
      const { svc } = build(false, false);
      const r = await svc.reportIncident('u1', 'customer', { type: 'SOS', severity: 'LIFE_THREATENING' });
      expect(r.trustedContacts).toEqual({ total: 2, notified: 0, smsConfigured: false });
    });
    it('a failing SMS provider never fails the SOS', async () => {
      const { svc, sms } = build();
      sms.send.mockRejectedValue(new Error('gateway down'));
      await expect(svc.reportIncident('u1', 'customer', { type: 'SOS', severity: 'LIFE_THREATENING' })).resolves.toBeTruthy();
    });
  });

  describe('property emergency', () => {
    const dto = { type: 'SOS', severity: 'PROPERTY_DAMAGE', sosKind: 'WATER' as const, addressId: 'a1', idempotencyKey: 'sos-key-0001' };
    it('creates an urgent job through the normal path, links it, and chooses the trade by hazard', async () => {
      const { svc, jobs, prisma } = build();
      const r = await svc.reportIncident('u1', 'customer', dto);
      const [user, job] = jobs.create.mock.calls[0];
      expect(user).toMatchObject({ id: 'u1', type: 'customer' });
      expect(job).toMatchObject({ categoryId: 'cat-plumbing', addressId: 'a1', when: 'NOW', isEmergency: true, idempotencyKey: 'sos:sos-key-0001' });
      expect(prisma.serviceCategory.findFirst.mock.calls[0][0].where.name).toBe(SOS_CATEGORY.WATER);
      expect(prisma.incident.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { jobRequestId: 'job1' } });
      expect(r.jobId).toBe('job1');
    });
    it('needs hazard kind, address and an idempotency key', async () => {
      const { svc, jobs } = build();
      await expect(svc.reportIncident('u1', 'customer', { type: 'SOS', severity: 'PROPERTY_DAMAGE' })).rejects.toMatchObject({ response: { code: 'SOS_DETAILS_REQUIRED' } });
      expect(jobs.create).not.toHaveBeenCalled();
    });
    it('a retry returns the same incident and does NOT dispatch twice', async () => {
      const { svc, jobs, prisma } = build();
      prisma.incident.findUnique.mockResolvedValue({ id: 'i1', severity: 'PROPERTY_DAMAGE', jobRequestId: 'job1' });
      const r = await svc.reportIncident('u1', 'customer', dto);
      expect(r.replay).toBe(true);
      expect(r.jobId).toBe('job1');
      expect(jobs.create).not.toHaveBeenCalled();
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });
    it('a worker reporting property damage is recorded but never dispatches a job', async () => {
      const { svc, jobs } = build();
      await svc.reportIncident('w1', 'worker', { type: 'REPORT_PROBLEM', severity: 'PROPERTY_DAMAGE' });
      expect(jobs.create).not.toHaveBeenCalled();
    });
  });

  it('limits trusted contacts to 5 (but allows editing an existing one)', async () => {
    const { svc, prisma } = build();
    prisma.trustedContact.findUnique.mockResolvedValue(null);
    prisma.trustedContact.count.mockResolvedValue(5);
    await expect(svc.addTrustedContact('u1', { name: 'X', phone: '+923001112223' })).rejects.toBeInstanceOf(BadRequestException);
    prisma.trustedContact.findUnique.mockResolvedValue({ id: 't1' });
    prisma.trustedContact.upsert.mockResolvedValue({});
    await expect(svc.addTrustedContact('u1', { name: 'X', phone: '+923001112223' })).resolves.toBeDefined();
  });
});
