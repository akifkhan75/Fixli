import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SweeperService } from '../src/matching/sweeper.service';
import { seedCatalog } from '../prisma/seed-catalog';

const HOME = { lat: 24.92, lng: 67.09 };
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

/** SOS: life-threatening never dispatches; property emergencies dispatch nearest-first then cascade (doc 27 R3). */
describe('Safety & SOS (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let sweeper: SweeperService;
  const tag = `sos${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let plumbingId: string;
  let addressId: string;
  let n = 0;
  const key = () => `${tag}-${++n}-zzzzzzzz`;

  async function user(k: string, type: 'customer' | 'worker', worker?: Record<string, unknown>, skills: string[] = []) {
    const u = await prisma.user.create({ data: { name: `${k} Person`, email: `${tag}-${k}@t.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK' } });
    if (type === 'worker') {
      await prisma.worker.create({
        data: {
          id: u.id, activationStatus: 'ACTIVE', isOnline: true, isVerified: true, serviceRadius: 10, ...worker,
          services: { create: skills.map((categoryId) => ({ categoryId })) },
          workingHours: { create: ALL_WEEK },
        } as any,
      });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${k}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3_600_000) } });
    ids[k] = u.id;
    tokens[k] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  const matched = async (jobId: string) =>
    (await prisma.jobMatch.findMany({ where: { jobRequestId: jobId }, orderBy: [{ round: 'asc' }, { rank: 'asc' }] })).map((m) => ({ who: Object.keys(ids).find((k) => ids[k] === m.workerId), round: m.round }));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    sweeper = app.get(SweeperService);
    await seedCatalog(prisma as any);
    plumbingId = (await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } })).id;
    await user('cust', 'customer');
    await user('other', 'customer');
    await user('near', 'worker', { serviceLat: 24.928, serviceLng: 67.095, rating: 3.8 }, [plumbingId]); // ~1 km, modest rating
    await user('mid', 'worker', { serviceLat: 24.955, serviceLng: 67.09, rating: 4.9 }, [plumbingId]); // ~4 km, best rating
    addressId = (await prisma.address.create({ data: { userId: ids.cust, streetAddress: 'House 12', city: 'Karachi', area: 'Gulshan', country: 'PK', latitude: HOME.lat, longitude: HOME.lng, isDefault: true } })).id;
  }, 60_000);

  afterAll(async () => {
    // Leave no matchable workers behind: other suites share this database.
    const userIds = Object.values(ids);
    await prisma.incident.deleteMany({ where: { reporterId: { in: userIds } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('emergency numbers come from country config', async () => {
    const r = await http().get('/api/safety/emergency-numbers').set(as('cust')).expect(200);
    expect(r.body.country).toBe('PK');
    expect(r.body.numbers).toEqual([{ label: 'Police', number: '15' }, { label: 'Rescue', number: '1122' }]);
  });

  it('trusted contacts need an international number and are private to the owner', async () => {
    await http().post('/api/safety/trusted-contacts').set(as('cust')).send({ name: 'Ali', phone: '0300 1112223' }).expect(400);
    await http().post('/api/safety/trusted-contacts').set(as('cust')).send({ name: 'Ali', phone: '+923001112223' }).expect(201);
    const mine = await http().get('/api/safety/trusted-contacts').set(as('cust')).expect(200);
    expect(mine.body).toHaveLength(1);
    expect((await http().get('/api/safety/trusted-contacts').set(as('other')).expect(200)).body).toHaveLength(0);
  });

  it('LIFE-THREATENING: records the incident, returns the numbers, never creates a job', async () => {
    const before = await prisma.jobRequest.count({ where: { customerId: ids.cust } });
    const r = await http().post('/api/safety/incidents').set(as('cust')).send({ type: 'SOS', severity: 'LIFE_THREATENING', latitude: 24.9, longitude: 67.1 }).expect(201);
    expect(r.body.jobId).toBeNull();
    expect(r.body.emergencyNumbers.map((x: any) => x.number)).toEqual(['15', '1122']);
    expect(r.body.disclaimer).toMatch(/does NOT replace/);
    expect(r.body.trustedContacts).toMatchObject({ total: 1, notified: 0, smsConfigured: false }); // no provider in tests: honest zero
    expect(await prisma.jobRequest.count({ where: { customerId: ids.cust } })).toBe(before);
    expect(await prisma.incident.count({ where: { reporterId: ids.cust, severity: 'LIFE_THREATENING' } })).toBe(1);
  });

  describe('property emergency', () => {
    let jobId: string;
    const sos = { type: 'SOS', severity: 'PROPERTY_DAMAGE', sosKind: 'WATER', description: 'Pipe burst in the kitchen' };
    let sosKey: string;

    it('rejects an SOS without hazard kind / address / key', async () => {
      await http().post('/api/safety/incidents').set(as('cust')).send({ type: 'SOS', severity: 'PROPERTY_DAMAGE' }).expect(400);
    });

    it('only the customer\'s own address can be used', async () => {
      await http().post('/api/safety/incidents').set(as('other')).send({ ...sos, addressId, idempotencyKey: key() }).expect(400);
    });

    it('creates an emergency job and tells ONLY the nearest worker first (not the best-rated)', async () => {
      sosKey = key();
      const r = await http().post('/api/safety/incidents').set(as('cust')).send({ ...sos, addressId, idempotencyKey: sosKey }).expect(201);
      jobId = r.body.jobId;
      expect(jobId).toBeTruthy();
      const job = await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } });
      expect(job).toMatchObject({ isEmergency: true, urgency: 'emergency', status: 'MATCHES_FOUND', matchRound: 1, categoryId: plumbingId });
      expect(job.description).toMatch(/burst pipe/);
      expect(await matched(jobId)).toEqual([{ who: 'near', round: 1 }]);
      expect((await prisma.notification.findFirst({ where: { userId: ids.near, type: 'job.emergency_request' } }))?.title).toMatch(/EMERGENCY/);
      expect(await prisma.notification.count({ where: { userId: ids.mid, type: { startsWith: 'job.' } } })).toBe(0);
    });

    it('a retried SOS returns the same job: no second incident, no second dispatch', async () => {
      const again = await http().post('/api/safety/incidents').set(as('cust')).send({ ...sos, addressId, idempotencyKey: sosKey }).expect(201);
      expect(again.body.jobId).toBe(jobId);
      expect(again.body.replay).toBe(true);
      expect(await prisma.jobRequest.count({ where: { customerId: ids.cust, isEmergency: true } })).toBe(1);
      expect(await prisma.incident.count({ where: { reporterId: ids.cust, idempotencyKey: sosKey } })).toBe(1);
    });

    it('nobody answers within the SOS window -> cascade to the next workers', async () => {
      await sweeper.sweep(); // window not elapsed: nothing changes
      expect(await matched(jobId)).toEqual([{ who: 'near', round: 1 }]);
      await prisma.jobRequest.update({ where: { id: jobId }, data: { lastMatchedAt: new Date(Date.now() - 4 * 60_000) } });
      await sweeper.sweep();
      const m = await matched(jobId);
      expect(m.map((x) => x.who).sort()).toEqual(['mid', 'near']);
      expect(m.find((x) => x.who === 'mid')?.round).toBe(2);
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).matchRound).toBe(2);
    });

    it('an emergency job cannot be started without the safety checklist', async () => {
      await prisma.jobRequest.update({ where: { id: jobId }, data: { status: 'ARRIVED', assignedWorkerId: ids.near, agreedAmount: 100000, agreedCurrency: 'PKR' } });
      const bad = await http().post(`/api/job-requests/${jobId}/start`).set(as('near')).send({}).expect(400);
      expect(JSON.stringify(bad.body)).toContain('HAZARD_CHECKLIST_REQUIRED');
      await http().post(`/api/job-requests/${jobId}/start`).set(as('near')).send({ shutoffVerified: true }).expect(400);
      await http().post(`/api/job-requests/${jobId}/start`).set(as('near')).send({ shutoffVerified: true, protectiveEquipment: true }).expect(201);
      expect((await prisma.jobRequest.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('IN_PROGRESS');
    });
  });
});
