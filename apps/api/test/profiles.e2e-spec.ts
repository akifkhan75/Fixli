import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { seedCatalog } from '../prisma/seed-catalog';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixli-e2e-storage-'));
process.env.STORAGE_LOCAL_DIR = storageDir;

const jpeg = (extra = 600) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(extra, 7)]);
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

describe('Profiles, uploads, onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = `prof${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const http = () => request(app.getHttpServer());

  async function makeUser(key: string, type: 'customer' | 'worker' | 'admin', worker: Record<string, unknown> = {}) {
    const user = await prisma.user.create({
      data: { name: `${key} User`, email: `${tag}-${key}@test.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK', ...(type === 'admin' ? { adminRoles: ['Super Admin'] } : {}) },
    });
    if (type === 'worker') await prisma.worker.create({ data: { id: user.id, activationStatus: 'ONBOARDING', ...worker } });
    const session = await prisma.session.create({ data: { userId: user.id, deviceId: `dev-${key}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[key] = user.id;
    tokens[key] = jwt.sign({ sub: user.id, type, sid: session.id });
  }

  /** The full direct-upload dance the app performs. */
  async function upload(who: string, purpose: string, bytes: Buffer = jpeg(), mime = 'image/jpeg') {
    const slot = await http().post('/api/uploads').set(as(who)).send({ purpose, mime, size: bytes.length }).expect(201);
    await http().put(pathOf(slot.body.upload.url)).set('Content-Type', mime).send(bytes).expect(200);
    const done = await http().post(`/api/uploads/${slot.body.id}/complete`).set(as(who)).expect(201);
    return { id: slot.body.id as string, ...done.body };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0); // one real listener: supertest otherwise opens a new server per request and flakes under load
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await seedCatalog(prisma as any);
    await makeUser('cust', 'customer');
    await makeUser('cust2', 'customer');
    await makeUser('work', 'worker');
    await makeUser('admin', 'admin');
  });

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fs.rmSync(storageDir, { recursive: true, force: true });
    await app.close();
  });

  describe('catalog', () => {
    it('is public, real, translated and ordered, with common problems', async () => {
      const res = await http().get('/api/service-catalog/categories').expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(10);
      const plumbing = res.body.find((c: any) => c.name === 'PLUMBING');
      expect(plumbing.translations.ur.name).toBeTruthy();
      expect(plumbing.issues.find((i: any) => i.code === 'leaking_tap').translations.ur.name).toBeTruthy();
      expect(plumbing.services.length).toBeGreaterThan(0);
      expect(res.body.map((c: any) => c.sortOrder)).toEqual([...res.body.map((c: any) => c.sortOrder)].sort((a, b) => a - b));
    });
    it('only admins can change it', async () => {
      await http().post('/api/service-catalog/categories').set(as('cust')).send({ name: 'HACK' }).expect(403);
    });
  });

  describe('uploads', () => {
    it('refuses unsupported types and oversize files up front', async () => {
      const bad = await http().post('/api/uploads').set(as('cust')).send({ purpose: 'AVATAR', mime: 'application/pdf', size: 100 }).expect(400);
      expect(bad.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      const big = await http().post('/api/uploads').set(as('cust')).send({ purpose: 'AVATAR', mime: 'image/jpeg', size: 4 * 1024 * 1024 }).expect(413);
      expect(big.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects a non-image disguised as a JPEG, and deletes it', async () => {
      const exe = Buffer.from('MZ' + 'A'.repeat(600));
      const slot = await http().post('/api/uploads').set(as('cust')).send({ purpose: 'AVATAR', mime: 'image/jpeg', size: exe.length }).expect(201);
      await http().put(pathOf(slot.body.upload.url)).set('Content-Type', 'image/jpeg').send(exe).expect(200);
      const done = await http().post(`/api/uploads/${slot.body.id}/complete`).set(as('cust')).expect(400);
      expect(done.body.error.code).toBe('UPLOAD_NOT_AN_IMAGE');
      const row = await prisma.upload.findUnique({ where: { id: slot.body.id } });
      expect(row?.status).toBe('REJECTED');
      expect(fs.existsSync(path.join(storageDir, row!.key))).toBe(false);
    });

    it('the upload link cannot be tampered with or used to send more than declared', async () => {
      const bytes = jpeg();
      const slot = await http().post('/api/uploads').set(as('cust')).send({ purpose: 'AVATAR', mime: 'image/jpeg', size: bytes.length }).expect(201);
      const p = pathOf(slot.body.upload.url);
      await http().put(p.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64))).set('Content-Type', 'image/jpeg').send(bytes).expect(403);
      await http().put(p.replace(/size=\d+/, 'size=99999999')).set('Content-Type', 'image/jpeg').send(bytes).expect(403);
      await http().put(p).set('Content-Type', 'image/jpeg').send(Buffer.concat([bytes, Buffer.alloc(5000)])).expect(413);
    });

    it("another user cannot complete or fetch someone else's upload", async () => {
      const bytes = jpeg();
      const slot = await http().post('/api/uploads').set(as('cust')).send({ purpose: 'AVATAR', mime: 'image/jpeg', size: bytes.length }).expect(201);
      await http().post(`/api/uploads/${slot.body.id}/complete`).set(as('cust2')).expect(404);
    });

    it('requires login', async () => {
      await http().post('/api/uploads').send({ purpose: 'AVATAR', mime: 'image/jpeg', size: 10 }).expect(401);
    });
  });

  describe('customer profile', () => {
    it('sets an avatar that is then served publicly, once only', async () => {
      const up = await upload('cust', 'AVATAR');
      expect(up.status).toBe('READY');
      const me = await http().patch('/api/users/me').set(as('cust')).send({ avatarUploadId: up.id, name: '  Aisha Khan ' }).expect(200);
      expect(me.body.name).toBe('Aisha Khan');
      expect(me.body.profileImageUrl).toMatch(/\/files\/public\/avatar\/.+\.jpg$/);
      const file = await http().get(pathOf(me.body.profileImageUrl)).expect(200);
      expect(file.headers['content-type']).toBe('image/jpeg');
      expect(file.headers['x-content-type-options']).toBe('nosniff');

      // reuse, and another user trying the same upload id, both fail
      await http().patch('/api/users/me').set(as('cust')).send({ avatarUploadId: up.id }).expect(400);
      await http().patch('/api/users/me').set(as('cust2')).send({ avatarUploadId: up.id }).expect(400);
    });

    it('can remove the avatar; cannot change phone, type or status', async () => {
      const me = await http().patch('/api/users/me').set(as('cust')).send({ removeAvatar: true }).expect(200);
      expect(me.body.profileImageUrl).toBeNull();
      for (const body of [{ phone: '+923001112222' }, { type: 'admin' }, { status: 'SUSPENDED' }]) {
        await http().patch('/api/users/me').set(as('cust')).send(body).expect(400);
      }
    });

    it('the avatar URL shows up wherever the user is embedded (single central rule)', async () => {
      const up = await upload('cust', 'AVATAR');
      await http().patch('/api/users/me').set(as('cust')).send({ avatarUploadId: up.id }).expect(200);
      const auth = await http().get('/api/auth/me').set(as('cust')).expect(200);
      expect(auth.body.profileImageUrl).toMatch(/^https?:\/\//);
    });
  });

  describe('addresses', () => {
    const addr = (over: object = {}) => ({ label: 'Home', streetAddress: 'House 12, Street 4', city: 'Karachi', country: 'pk', ...over });
    const created: string[] = [];

    it('the first address becomes the default; country is normalised; postal code is optional', async () => {
      const a = await http().post('/api/addresses').set(as('cust2')).send(addr({ area: 'Gulshan Block 13', landmark: 'Near the mosque', latitude: 24.92, longitude: 67.09 })).expect(201);
      expect(a.body).toMatchObject({ isDefault: true, country: 'PK', area: 'Gulshan Block 13', postalCode: null });
      created.push(a.body.id);
    });

    it('a second default replaces the first; deleting the default promotes another', async () => {
      const b = await http().post('/api/addresses').set(as('cust2')).send(addr({ label: 'Work', isDefault: true })).expect(201);
      created.push(b.body.id);
      let list = await http().get('/api/addresses').set(as('cust2')).expect(200);
      expect(list.body.filter((x: any) => x.isDefault)).toHaveLength(1);
      expect(list.body[0].id).toBe(b.body.id);
      await http().delete(`/api/addresses/${b.body.id}`).set(as('cust2')).expect(200);
      list = await http().get('/api/addresses').set(as('cust2')).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].isDefault).toBe(true);
    });

    it('rejects half a coordinate pair and bad ranges', async () => {
      await http().post('/api/addresses').set(as('cust2')).send(addr({ latitude: 24.9 })).expect(400);
      await http().post('/api/addresses').set(as('cust2')).send(addr({ latitude: 124.9, longitude: 67 })).expect(400);
    });

    it("is private to the owner", async () => {
      await http().patch(`/api/addresses/${created[0]}`).set(as('cust')).send({ label: 'Mine' }).expect(404);
      await http().delete(`/api/addresses/${created[0]}`).set(as('cust')).expect(404);
      const mine = await http().get('/api/addresses').set(as('cust')).expect(200);
      expect(mine.body.find((x: any) => x.id === created[0])).toBeUndefined();
    });

    it('has a limit of 10 addresses', async () => {
      for (let i = 0; i < 9; i++) await http().post('/api/addresses').set(as('cust2')).send(addr({ label: `A${i}` })).expect(201);
      const over = await http().post('/api/addresses').set(as('cust2')).send(addr({ label: 'Too many' })).expect(409);
      expect(over.body.error.code).toBe('ADDRESS_LIMIT');
    });
  });

  describe('worker onboarding → admin approval → public profile', () => {
    let plumbingId: string;
    let idCaseId: string;

    it('a new worker has nothing done and cannot go online or be found', async () => {
      const me = await http().get('/api/workers/me').set(as('work')).expect(200);
      expect(me.body.onboarding).toMatchObject({ complete: false, percent: 0 });
      expect(me.body.onboarding.missing).toEqual(['skills', 'area', 'hours', 'pricing', 'documents']);
      const online = await http().patch('/api/workers/me').set(as('work')).send({ isOnline: true }).expect(403);
      expect(online.body.error.code).toBe('WORKER_NOT_ACTIVE');
      const list = await http().get('/api/workers').set(as('cust')).expect(200);
      expect(list.body.find((w: any) => w.id === ids.work)).toBeUndefined();
      await http().get(`/api/workers/${ids.work}`).set(as('cust')).expect(404);
    });

    it('fills skills, area, hours and pricing with validation', async () => {
      const cats = await http().get('/api/service-catalog/categories').expect(200);
      plumbingId = cats.body.find((c: any) => c.name === 'PLUMBING').id;
      await http().put('/api/workers/me/skills').set(as('work')).send({ categoryIds: [plumbingId, 'ghost'] }).expect(400);
      await http().put('/api/workers/me/skills').set(as('work')).send({ categoryIds: [plumbingId] }).expect(200);
      await http().patch('/api/workers/me').set(as('work')).send({ serviceLat: 24.86, serviceLng: 67.0, serviceAreaLabel: 'Gulshan, Karachi', serviceRadius: 10, bio: 'Ten years of plumbing.', experienceYears: 10, languages: ['Urdu', 'English'], gender: 'MALE' }).expect(200);
      await http().put('/api/workers/me/hours').set(as('work')).send({ days: [{ weekday: 1, startMinute: 600, endMinute: 540 }] }).expect(400);
      await http().put('/api/workers/me/hours').set(as('work')).send({ days: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1080 })) }).expect(200);
      await http().patch('/api/workers/me').set(as('work')).send({ pricingModel: 'CALLOUT_PLUS_QUOTE', minimumCallOutFee: 150000.5 }).expect(400);
      const me = await http().patch('/api/workers/me').set(as('work')).send({ pricingModel: 'CALLOUT_PLUS_QUOTE', minimumCallOutFee: 150000 }).expect(200);
      expect(me.body.onboarding.missing).toEqual(['documents']);
      expect(me.body.onboarding.percent).toBe(80);
    });

    it('cannot submit for review until documents are in', async () => {
      const r = await http().post('/api/workers/me/submit').set(as('work')).expect(400);
      expect(r.body.error.code).toBe('PROFILE_INCOMPLETE');
      expect(r.body.error.details).toEqual(['documents']);
    });

    it('uploads ID (both sides) and a selfie; documents are private', async () => {
      const front = await upload('work', 'VERIFICATION');
      expect(front.url).toBeNull(); // no public URL for identity documents
      const back = await upload('work', 'VERIFICATION');
      const selfie = await upload('work', 'VERIFICATION');

      const oneSide = await http().post('/api/workers/me/verification').set(as('work')).send({ type: 'ID', uploadIds: [front.id] }).expect(400);
      expect(oneSide.body.error.code).toBe('ID_NEEDS_TWO_SIDES');
      // an avatar-purpose upload cannot be used as a document
      const wrongPurpose = await upload('work', 'AVATAR');
      await http().post('/api/workers/me/verification').set(as('work')).send({ type: 'SELFIE', uploadIds: [wrongPurpose.id] }).expect(400);

      const res = await http().post('/api/workers/me/verification').set(as('work')).send({ type: 'ID', uploadIds: [front.id, back.id], reference: '42101-1234567-1' }).expect(201);
      expect(JSON.stringify(res.body)).not.toMatch(/verification\/.+\.jpg/); // locations never come back to the app
      await http().post('/api/workers/me/verification').set(as('work')).send({ type: 'SELFIE', uploadIds: [selfie.id] }).expect(201);

      // not reachable through the public file route, with or without guessing the key
      const row = await prisma.upload.findUnique({ where: { id: front.id } });
      await http().get(`/api/files/public/${row!.key}`).expect(404);
      // only the owner (or an admin) can mint a signed link
      await http().get(`/api/uploads/${front.id}/url`).set(as('cust')).expect(404);
      const link = await http().get(`/api/uploads/${front.id}/url`).set(as('work')).expect(200);
      await http().get(pathOf(link.body.url)).expect(200);
      await http().get(pathOf(link.body.url).replace(/sig=[0-9a-f]+/, 'sig=' + '1'.repeat(64))).expect(403);
    });

    it('submits for review; still cannot go online or be found', async () => {
      const me = await http().post('/api/workers/me/submit').set(as('work')).expect(201);
      expect(me.body.activationStatus).toBe('PENDING_REVIEW');
      expect(me.body.onboarding.complete).toBe(true);
      await http().post('/api/workers/me/submit').set(as('work')).expect(409);
      await http().patch('/api/workers/me').set(as('work')).send({ isOnline: true }).expect(403);
    });

    it('only admins can see the queue; documents are viewed through audited, expiring links', async () => {
      await http().get('/api/admin/v1/verification-cases').set(as('cust')).expect(403);
      await http().get('/api/admin/v1/verification-cases').set(as('work')).expect(403);
      const queue = await http().get('/api/admin/v1/verification-cases').set(as('admin')).expect(200);
      const mine = queue.body.items.filter((c: any) => c.worker.id === ids.work);
      expect(mine.map((c: any) => c.type).sort()).toEqual(['ID', 'SELFIE']);
      idCaseId = mine.find((c: any) => c.type === 'ID').id;

      const detail = await http().get(`/api/admin/v1/verification-cases/${idCaseId}`).set(as('admin')).expect(200);
      expect(detail.body.documents).toHaveLength(2);
      expect(detail.body.reference).toBe('42101-1234567-1');
      expect(JSON.stringify(detail.body)).not.toMatch(/"documentKeys"/);
      await http().get(pathOf(detail.body.documents[0].url)).expect(200);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'verification.documents_viewed', entityId: idCaseId } });
      expect(audit?.actorId).toBe(ids.admin);
    });

    it('a rejection needs a reason, sends the worker back, and shows them why', async () => {
      await http().post(`/api/admin/v1/verification-cases/${idCaseId}/decision`).set(as('admin')).send({ decision: 'REJECT' }).expect(400);
      await http().post(`/api/admin/v1/verification-cases/${idCaseId}/decision`).set(as('admin')).send({ decision: 'REJECT', reason: 'Photo is blurry, please retake.' }).expect(201);
      await http().post(`/api/admin/v1/verification-cases/${idCaseId}/decision`).set(as('admin')).send({ decision: 'APPROVE' }).expect(409); // already decided
      const me = await http().get('/api/workers/me').set(as('work')).expect(200);
      expect(me.body.activationStatus).toBe('ONBOARDING');
      expect(me.body.verifications.find((v: any) => v.type === 'ID')).toMatchObject({ status: 'REJECTED', reason: 'Photo is blurry, please retake.' });
      expect(me.body.onboarding.missing).toEqual(['documents']);
    });

    it('the worker resubmits; approving both documents activates them', async () => {
      const front = await upload('work', 'VERIFICATION');
      const back = await upload('work', 'VERIFICATION');
      await http().post('/api/workers/me/verification').set(as('work')).send({ type: 'ID', uploadIds: [front.id, back.id] }).expect(201);
      await http().post('/api/workers/me/submit').set(as('work')).expect(201);

      const queue = await http().get('/api/admin/v1/verification-cases').set(as('admin')).expect(200);
      for (const c of queue.body.items.filter((c: any) => c.worker.id === ids.work)) {
        await http().post(`/api/admin/v1/verification-cases/${c.id}/decision`).set(as('admin')).send({ decision: 'APPROVE' }).expect(201);
      }
      const me = await http().get('/api/workers/me').set(as('work')).expect(200);
      expect(me.body.activationStatus).toBe('ACTIVE');
      expect(me.body.isVerified).toBe(true);
      await http().patch('/api/workers/me').set(as('work')).send({ isOnline: true }).expect(200);
    });

    it('approvals and rejections are in the audit log', async () => {
      const actions = (await prisma.auditLog.findMany({ where: { actorId: ids.admin }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['verification.rejected', 'verification.approved', 'verification.documents_viewed']));
    });

    it('the public profile shows real, dated badges, portfolio, and never contact details', async () => {
      const shot = await upload('work', 'PORTFOLIO');
      await http().post('/api/workers/me/portfolio').set(as('work')).send({ title: 'Kitchen sink replaced', uploadIds: [shot.id] }).expect(201);

      const profile = await http().get(`/api/workers/${ids.work}`).set(as('cust')).expect(200);
      expect(profile.body.badges.map((b: any) => b.type).sort()).toEqual(['ID', 'SELFIE']);
      expect(profile.body.badges[0].verifiedAt).toBeTruthy();
      expect(profile.body.portfolio[0].photos[0]).toMatch(/\/files\/public\/portfolio\//);
      expect(profile.body).toMatchObject({ bio: 'Ten years of plumbing.', serviceAreaLabel: 'Gulshan, Karachi', ratingCount: 0, jobsCompleted: 0 });
      expect(JSON.stringify(profile.body)).not.toMatch(/@test\.com|phone|serviceLat|serviceLng|documentKeys|verification\//);

      const list = await http().get('/api/workers').set(as('cust')).expect(200);
      expect(list.body.find((w: any) => w.id === ids.work)).toBeTruthy();
    });

    it('hide-my-photo works until the customer has booked them', async () => {
      const avatar = await upload('work', 'AVATAR');
      await http().patch('/api/users/me').set(as('work')).send({ avatarUploadId: avatar.id }).expect(200);
      await http().patch('/api/workers/me').set(as('work')).send({ hidePhotoUntilBooked: true }).expect(200);

      const before = await http().get(`/api/workers/${ids.work}`).set(as('cust')).expect(200);
      expect(before.body.user.profileImageUrl).toBeNull();

      const job = await prisma.jobRequest.create({ data: { customerId: ids.cust, customerName: 'c', description: 'Leaking tap in kitchen', status: 'ACCEPTED', assignedWorkerId: ids.work } });
      const after = await http().get(`/api/workers/${ids.work}`).set(as('cust')).expect(200);
      expect(after.body.user.profileImageUrl).toMatch(/\/files\/public\/avatar\//);
      const other = await http().get(`/api/workers/${ids.work}`).set(as('cust2')).expect(200);
      expect(other.body.user.profileImageUrl).toBeNull();
      await prisma.jobRequest.delete({ where: { id: job.id } });
    });

    it('stats are real counts and admin-only', async () => {
      await http().get('/api/admin/v1/stats').set(as('cust')).expect(403);
      const stats = await http().get('/api/admin/v1/stats').set(as('admin')).expect(200);
      expect(stats.body.workers.ACTIVE).toBeGreaterThanOrEqual(1);
      expect(typeof stats.body.pendingVerifications).toBe('number');
    });
  });
});
