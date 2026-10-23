import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SafetyService } from './safety.service';

describe('SafetyService', () => {
  const tx: any = { $queryRaw: jest.fn(), trustedContact: { findUnique: jest.fn(), count: jest.fn(), upsert: jest.fn() } };
  const prisma: any = {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    incident: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    jobRequest: { findFirst: jest.fn() },
    address: { findFirst: jest.fn() },
    serviceCategory: { findUnique: jest.fn() },
    trustedContact: { findMany: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const jobs = { create: jest.fn() };
  const sos = { start: jest.fn() };
  const events = { emit: jest.fn() };
  const audit = { record: jest.fn() };
  const countries = { get: jest.fn(async () => ({ countryCode: 'PK', emergencyNumbers: [{ label: 'Rescue', number: '1122' }] })) };
  const sms = { name: 'fake', configured: true, send: jest.fn(async () => ({ ok: true })) };
  const make = (s: any = sms) => new SafetyService(prisma, jobs as any, sos as any, events as any, audit as any, countries as any, s as any);
  const customer = { id: 'c1', type: 'customer' };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    prisma.user.findUnique.mockResolvedValue({ countryCode: 'PK' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ name: 'Ayesha', locale: 'en', countryCode: 'PK', phone: '+923001112222' });
    prisma.incident.findUnique.mockResolvedValue(null);
    prisma.incident.create.mockImplementation(async ({ data }: any) => ({ id: 'i1', ...data }));
    prisma.incident.findUniqueOrThrow.mockImplementation(async () => ({ id: 'i1', kind: prisma.incident.create.mock.calls[0]?.[0].data.kind, jobRequestId: 'j1', contactsAlertStatus: prisma.incident.update.mock.calls[0]?.[0].data.contactsAlertStatus ?? null, contactsAlerted: prisma.incident.update.mock.calls[0]?.[0].data.contactsAlerted ?? 0 }));
    prisma.address.findFirst.mockResolvedValue({ id: 'a1', area: 'Gulshan', city: 'Karachi' });
    prisma.trustedContact.findMany.mockResolvedValue([{ phone: '+923001234567' }, { phone: '+923009876543' }]);
  });

  it('life-threatening: numbers + safety team + contacts texted, and NO job or worker', async () => {
    const r = await make().raiseSos(customer, { kind: 'LIFE_THREATENING', idempotencyKey: 'k1' });
    expect(jobs.create).not.toHaveBeenCalled();
    expect(sos.start).not.toHaveBeenCalled();
    expect(prisma.incident.create.mock.calls[0][0].data).toMatchObject({ type: 'SOS', kind: 'LIFE_THREATENING', severity: 'LIFE_THREATENING', idempotencyKey: 'sos:c1:k1' });
    expect(events.emit).toHaveBeenCalledWith('admin.incident_reported', { incidentId: 'i1', type: 'SOS' });
    expect(sms.send).toHaveBeenCalledTimes(2);
    const text = (sms.send.mock.calls as any[])[0][1] as string;
    expect(text).toMatch(/Ayesha pressed the SOS button/);
    expect(text).toMatch(/Approximate area: Gulshan, Karachi/);
    expect(text).not.toMatch(/police|ambulance has been/i); // never claims anyone was called
    expect(r).toMatchObject({ emergencyNumbers: [{ number: '1122' }], contacts: { status: 'SENT', alerted: 2 } });
  });

  it('without an SMS provider it says so honestly: contacts NOT told', async () => {
    const r = await make({ name: 'none', configured: false, send: jest.fn() }).raiseSos(customer, { kind: 'LIFE_THREATENING', idempotencyKey: 'k2' });
    expect(r.contacts).toMatchObject({ status: 'NO_PROVIDER', alerted: 0, message: expect.stringMatching(/NOT told/) });
  });

  it('a double tap returns the same emergency', async () => {
    prisma.incident.findUnique.mockResolvedValue({ id: 'i0' });
    prisma.incident.findUniqueOrThrow.mockResolvedValue({ id: 'i0', kind: 'LIFE_THREATENING', contactsAlertStatus: 'SENT', contactsAlerted: 2 });
    await expect(make().raiseSos(customer, { kind: 'LIFE_THREATENING', idempotencyKey: 'k1' })).resolves.toMatchObject({ incidentId: 'i0' });
    expect(prisma.incident.create).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('water/electric/gas: an urgent job (no normal matching yet) handed to SOS dispatch', async () => {
    prisma.serviceCategory.findUnique.mockResolvedValue({ id: 'cat-plumb' });
    jobs.create.mockResolvedValue({ id: 'j1' });
    const r = await make().raiseSos(customer, { kind: 'WATER', idempotencyKey: 'k3' });
    expect(jobs.create.mock.calls[0][1]).toMatchObject({ categoryId: 'cat-plumb', addressId: 'a1', when: 'NOW', isEmergency: true });
    expect(jobs.create.mock.calls[0][2]).toEqual({ skipMatching: true });
    expect(sos.start).toHaveBeenCalledWith('j1', 'i1');
    expect(r.jobRequestId).toBe('j1');
  });

  it('in-job SOS must be about your own job; the other person is recorded', async () => {
    prisma.jobRequest.findFirst.mockResolvedValue(null);
    await expect(make().raiseSos(customer, { kind: 'IN_JOB', jobRequestId: 'x', idempotencyKey: 'k4' })).rejects.toThrow(NotFoundException);
    prisma.jobRequest.findFirst.mockResolvedValue({ id: 'j1', customerId: 'c1', assignedWorkerId: 'w1' });
    await make().raiseSos(customer, { kind: 'IN_JOB', jobRequestId: 'j1', idempotencyKey: 'k5' });
    expect(prisma.incident.create.mock.calls.at(-1)[0].data).toMatchObject({ targetId: 'w1', jobRequestId: 'j1', severity: 'LIFE_THREATENING' });
  });

  it('reports: only about your own job and its other party; rate-limited', async () => {
    prisma.jobRequest.findFirst.mockResolvedValue({ customerId: 'c1', assignedWorkerId: 'w1' });
    await expect(make().reportIncident('c1', { type: 'REPORT_PROBLEM', severity: 'MODERATE', jobRequestId: 'j1', targetId: 'someone-else', description: 'x' })).rejects.toThrow(BadRequestException);
    await expect(make().reportIncident('c1', { type: 'REPORT_PROBLEM', severity: 'MODERATE', targetId: 'w1', description: 'x' })).rejects.toThrow(BadRequestException);
    prisma.incident.count.mockResolvedValue(5);
    await expect(make().reportIncident('c1', { type: 'REPORT_PROBLEM', severity: 'MODERATE', jobRequestId: 'j1', description: 'x' })).rejects.toMatchObject({ status: 429 });
  });

  it('trusted contacts: number normalised for the country; at most 5; not your own number', async () => {
    tx.trustedContact.findUnique.mockResolvedValue(null);
    tx.trustedContact.count.mockResolvedValue(0);
    tx.trustedContact.upsert.mockImplementation(async ({ create }: any) => create);
    await expect(make().addTrustedContact('c1', { name: 'Sister', phone: '0300 1234567' })).resolves.toMatchObject({ phone: '+923001234567' });
    await expect(make().addTrustedContact('c1', { name: 'Me', phone: '0300 1112222' })).rejects.toThrow(BadRequestException);
    await expect(make().addTrustedContact('c1', { name: 'Bad', phone: '12' })).rejects.toThrow(BadRequestException);
    tx.trustedContact.count.mockResolvedValue(5);
    await expect(make().addTrustedContact('c1', { name: 'Sixth', phone: '0301 7654321' })).rejects.toMatchObject({ response: { code: 'TOO_MANY_CONTACTS' } });
  });
});
