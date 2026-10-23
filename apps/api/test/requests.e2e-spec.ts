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
import { AI_PROVIDER, AiProvider } from '../src/ai/providers/ai-provider';
import { seedCatalog } from '../prisma/seed-catalog';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixli-e2e-req-'));
process.env.STORAGE_LOCAL_DIR = storageDir;

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.alloc(800, 3)]);
const m4a = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(900, 1)]);
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

/** Deterministic stand-in for Gemini: lets us test the real pipeline without a network or key. */
class FakeAi implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  mode: 'ok' | 'garbage' | 'down' = 'ok';
  calls: { prompt: string; mediaMimes: string[] }[] = [];
  available() { return this.mode !== 'down'; }
  async generate(input: { prompt: string; media?: { mime: string }[] }) {
    this.calls.push({ prompt: input.prompt, mediaMimes: (input.media ?? []).map((m) => m.mime) });
    if (input.prompt.startsWith('Transcribe')) return 'Kitchen ka nal raat bhar tapakta hai';
    if (this.mode === 'garbage') return 'I think it is probably a roof problem';
    return JSON.stringify({ categoryCode: 'PLUMBING', issueCodes: ['leaking_tap', 'made_up'], urgency: 'standard', severity: 'low', lifeThreatening: false, hazards: [], summary: 'Kitchen tap drips', confidence: 0.86, questions: ['Is it the hot or cold tap?'] });
  }
}

describe('Request a service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ai = new FakeAi();
  const tag = `req${Date.now()}`;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (w: string) => ({ Authorization: `Bearer ${tokens[w]}` });
  const http = () => request(app.getHttpServer());
  let plumbing: { id: string };
  let addressId: string;
  let k = 0;
  const key = () => `${tag}-${++k}-abcdefgh`;

  async function makeUser(key: string, type: 'customer' | 'worker', worker: object = {}) {
    const u = await prisma.user.create({ data: { name: `${key} Person`, email: `${tag}-${key}@test.com`, password: await bcrypt.hash('x', 4), type, countryCode: 'PK' } });
    if (type === 'worker') {
      const cat = await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } });
      await prisma.worker.create({
        data: {
          id: u.id, activationStatus: 'ACTIVE', isOnline: true, serviceLat: 24.93, serviceLng: 67.10, serviceRadius: 10,
          services: { create: [{ categoryId: cat.id }] },
          workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) },
          ...worker,
        },
      });
    }
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${key}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    ids[key] = u.id;
    tokens[key] = jwt.sign({ sub: u.id, type, sid: s.id });
  }

  async function upload(who: string, purpose: string, bytes: Buffer, mime: string) {
    const slot = await http().post('/api/uploads').set(as(who)).send({ purpose, mime, size: bytes.length }).expect(201);
    await http().put(pathOf(slot.body.upload.url)).set('Content-Type', mime).send(bytes).expect(200);
    await http().post(`/api/uploads/${slot.body.id}/complete`).set(as(who)).expect(201);
    return slot.body.id as string;
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AI_PROVIDER).useValue(ai).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await seedCatalog(prisma as any);
    plumbing = await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } });
    await makeUser('cust', 'customer');
    await makeUser('other', 'customer');
    await makeUser('work', 'worker');
    await makeUser('work2', 'worker', { isOnline: false });
    const a = await http().post('/api/addresses').set(as('cust')).send({ label: 'Home', streetAddress: 'House 12, Street 4', buildingDetail: 'Flat 3', area: 'Gulshan Block 13', city: 'Karachi', landmark: 'Opposite the mosque', country: 'PK', latitude: 24.92, longitude: 67.09 }).expect(201);
    addressId = a.body.id;
  });

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.jobAiAnalysis.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.workingHours.deleteMany({ where: { workerId: { in: userIds } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: { in: userIds } } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fs.rmSync(storageDir, { recursive: true, force: true });
    await app.close();
  });

  describe('AI analysis (suggestion only)', () => {
    it('suggests a real category, drops invented issue codes, looks at the photo, and records the call', async () => {
      const photo = await upload('cust', 'JOB_PHOTO', jpeg(), 'image/jpeg');
      ai.calls = [];
      const res = await http().post('/api/ai/analyze').set(as('cust')).send({ description: 'my kitchen tap drips all night', photoUploadIds: [photo] }).expect(201);
      expect(res.body).toMatchObject({ available: true, suggestion: { categoryId: plumbing.id, issueCodes: ['leaking_tap'], confidence: 0.86 }, safety: { lifeThreatening: false } });
      expect(ai.calls[0].mediaMimes).toEqual(['image/jpeg']);
      const row = await prisma.jobAiAnalysis.findUnique({ where: { id: res.body.analysisId } });
      expect(row).toMatchObject({ ownerId: ids.cust, provider: 'fake', model: 'fake-model', valid: true, promptVersion: expect.stringContaining('request-analysis') });
    });

    it('cannot analyse someone else\'s photo', async () => {
      const photo = await upload('other', 'JOB_PHOTO', jpeg(), 'image/jpeg');
      const res = await http().post('/api/ai/analyze').set(as('cust')).send({ description: 'tap', photoUploadIds: [photo] }).expect(400);
      expect(res.body.error.code).toBe('INVALID_UPLOAD');
    });

    it('a bad AI answer is reported as unavailable, never as a guess', async () => {
      ai.mode = 'garbage';
      const res = await http().post('/api/ai/analyze').set(as('cust')).send({ description: 'tap drips' }).expect(201);
      expect(res.body).toMatchObject({ available: false, suggestion: null });
      ai.mode = 'ok';
    });

    it('with the AI down, the safety rules still flag a gas smell', async () => {
      ai.mode = 'down';
      const res = await http().post('/api/ai/analyze').set(as('cust')).send({ description: 'I can smell gas near the stove' }).expect(201);
      expect(res.body).toMatchObject({ available: false, safety: { lifeThreatening: true, hazards: ['gas_leak'] } });
      ai.mode = 'ok';
    });

    it('workers cannot use the customer analysis endpoint', async () => {
      await http().post('/api/ai/analyze').set(as('work')).send({ description: 'tap drips' }).expect(403);
    });
  });

  describe('voice notes', () => {
    it('accepts a real recording, transcribes it, and rejects a fake one', async () => {
      const voice = await upload('cust', 'JOB_AUDIO', m4a(), 'audio/mp4');
      const t = await http().post('/api/ai/transcribe').set(as('cust')).send({ uploadId: voice, locale: 'ur' }).expect(201);
      expect(t.body.text).toBe('Kitchen ka nal raat bhar tapakta hai');

      const fakeAudio = Buffer.from('<html>not audio</html>'.padEnd(600, ' '));
      const slot = await http().post('/api/uploads').set(as('cust')).send({ purpose: 'JOB_AUDIO', mime: 'audio/mp4', size: fakeAudio.length }).expect(201);
      await http().put(pathOf(slot.body.upload.url)).set('Content-Type', 'audio/mp4').send(fakeAudio).expect(200);
      const done = await http().post(`/api/uploads/${slot.body.id}/complete`).set(as('cust')).expect(400);
      expect(done.body.error.code).toBe('UPLOAD_NOT_AUDIO');
    });

    it("cannot transcribe someone else's recording", async () => {
      const voice = await upload('other', 'JOB_AUDIO', m4a(), 'audio/mp4');
      await http().post('/api/ai/transcribe').set(as('cust')).send({ uploadId: voice }).expect(400);
    });

    it('when voice typing is down the user is told to type, with no fake text', async () => {
      ai.mode = 'down';
      const voice = await upload('cust', 'JOB_AUDIO', m4a(), 'audio/mp4');
      const r = await http().post('/api/ai/transcribe').set(as('cust')).send({ uploadId: voice }).expect(503);
      expect(r.body.error.code).toBe('AI_UNAVAILABLE');
      ai.mode = 'ok';
    });
  });

  describe('sending the request', () => {
    let jobId: string;
    let jobKey: string;

    it('creates a real job from taps, photo and voice, with the address snapshot and a time window', async () => {
      const photo = await upload('cust', 'JOB_PHOTO', jpeg(), 'image/jpeg');
      const voice = await upload('cust', 'JOB_AUDIO', m4a(), 'audio/mp4');
      const analysis = await http().post('/api/ai/analyze').set(as('cust')).send({ categoryId: plumbing.id, issueCodes: ['leaking_tap'], photoUploadIds: [photo] }).expect(201);
      jobKey = key();
      const res = await http().post('/api/job-requests').set(as('cust')).send({
        categoryId: plumbing.id, issueCodes: ['leaking_tap'], description: 'Under the kitchen sink',
        photoUploadIds: [photo], audioUploadId: voice, audioTranscript: 'Kitchen ka nal raat bhar tapakta hai',
        addressId, when: 'TOMORROW', timeSlot: 'EVENING', analysisId: analysis.body.analysisId, idempotencyKey: jobKey,
      }).expect(201);
      jobId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'MATCHES_FOUND', title: 'Leaking tap', whenOption: 'TOMORROW', area: 'Gulshan Block 13', city: 'Karachi',
        location: 'Flat 3, House 12, Street 4, Gulshan Block 13, Karachi', urgency: 'standard',
        category: { name: 'PLUMBING' }, issueCodes: ['leaking_tap'],
      });
      expect(res.body.description).toContain('Under the kitchen sink');
      expect(res.body.description).toContain('Kitchen ka nal');
      expect(new Date(res.body.scheduledFrom).getUTCHours()).toBe(12); // 17:00 Karachi
      expect(res.body.media.map((m: any) => m.kind)).toEqual(['PHOTO', 'AUDIO']);
      expect(res.body.media[1].transcript).toBe('Kitchen ka nal raat bhar tapakta hai');
      expect(res.body.events.map((e: any) => e.type)).toEqual(['REQUEST_SENT', 'PROFESSIONALS_NOTIFIED']);
      expect(res.body.notifiedCount).toBe(1); // 'work' is online nearby; 'work2' is offline
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|idempotencyKey|job_photo\//);
      const linked = await prisma.jobAiAnalysis.findUnique({ where: { id: analysis.body.analysisId } });
      expect(linked?.jobRequestId).toBe(jobId);
    });

    it('media links work, expire with a signature, and the uploads cannot be reused', async () => {
      const job = await http().get(`/api/job-requests/${jobId}`).set(as('cust')).expect(200);
      await http().get(pathOf(job.body.media[0].url)).expect(200);
      await http().get(pathOf(job.body.media[0].url).replace(/sig=[0-9a-f]+/, 'sig=' + 'a'.repeat(64))).expect(403);
      const used = await prisma.jobMedia.findFirst({ where: { jobRequestId: jobId, kind: 'PHOTO' } });
      await http().get(`/api/files/public/${used!.storageKey}`).expect(404); // job photos are never public
    });

    it('is idempotent: sending the same request again returns the same job', async () => {
      const again = await http().post('/api/job-requests').set(as('cust')).send({ categoryId: plumbing.id, issueCodes: ['leaking_tap'], addressId, when: 'TODAY', idempotencyKey: jobKey }).expect(201);
      expect(again.body.id).toBe(jobId);
      expect(await prisma.jobRequest.count({ where: { customerId: ids.cust, idempotencyKey: jobKey } })).toBe(1);
    });

    it('validates the request in plain language', async () => {
      const base = { categoryId: plumbing.id, addressId, when: 'TODAY' };
      const cases: [object, string][] = [
        [{ ...base, issueCodes: [], description: 'x' }, 'DESCRIBE_PROBLEM'],
        [{ ...base, issueCodes: ['roof_leak'] }, 'INVALID_ISSUE'],
        [{ ...base, issueCodes: ['leaking_tap'], when: 'SCHEDULED', date: '2020-01-01', timeSlot: 'MORNING' }, 'INVALID_TIME'],
        [{ ...base, issueCodes: ['leaking_tap'], when: 'SCHEDULED' }, 'INVALID_TIME'],
      ];
      for (const [body, code] of cases) {
        const r = await http().post('/api/job-requests').set(as('cust')).send({ ...body, idempotencyKey: key() }).expect(400);
        expect(r.body.error.code).toBe(code);
      }
    });

    it('an open job shows workers the area and photos, but not the exact address or full name', async () => {
      const w = await http().get(`/api/job-requests/${jobId}`).set(as('work')).expect(200);
      expect(w.body).toMatchObject({ area: 'Gulshan Block 13', city: 'Karachi', title: 'Leaking tap', customer: { name: 'cust' } });
      expect(w.body.location).toBeUndefined();
      expect(w.body.latitude).toBeUndefined();
      expect(JSON.stringify(w.body)).not.toMatch(/House 12|Flat 3|Opposite the mosque|24\.92/);
      expect(w.body.media.length).toBe(2);
    });

    it('once the worker is booked they get the exact address; other workers still do not see the job', async () => {
      await http().post(`/api/job-requests/${jobId}/request-worker`).set(as('cust')).send({ workerId: ids.work }).expect(201);
      const asked = await http().get(`/api/job-requests/${jobId}`).set(as('work')).expect(200);
      expect(asked.body.location).toBeUndefined(); // asked is not booked
      await http().post(`/api/job-requests/${jobId}/accept`).set(as('work')).expect(201);
      const booked = await http().get(`/api/job-requests/${jobId}`).set(as('work')).expect(200);
      expect(booked.body.location).toContain('House 12');
      expect(booked.body.latitude).toBe(24.92);
      await http().get(`/api/job-requests/${jobId}`).set(as('work2')).expect(404);
    });

    it('every step lands on the timeline in order', async () => {
      await http().post(`/api/job-requests/${jobId}/start`).set(as('work')).expect(400); // needs a before photo or a reason
      await http().post(`/api/job-requests/${jobId}/start`).set(as('work')).send({ photoSkipReason: 'CAMERA_UNAVAILABLE' }).expect(201);
      const job = await http().get(`/api/job-requests/${jobId}`).set(as('cust')).expect(200);
      expect(job.body.events.map((e: any) => e.type)).toEqual(['REQUEST_SENT', 'PROFESSIONALS_NOTIFIED', 'WORKER_REQUESTED', 'WORKER_ACCEPTED', 'WORK_STARTED']);
      expect(job.body.events[3]).toMatchObject({ fromStatus: 'AWAITING_WORKER', toStatus: 'ACCEPTED', actorId: ids.work });
    });

    it('cancelling records the reason; a started job cannot be cancelled by the customer', async () => {
      const late = await http().post(`/api/job-requests/${jobId}/cancel`).set(as('cust')).send({ reason: 'NO_LONGER_NEEDED' }).expect(409);
      expect(late.body.error.code).toBe('CANNOT_CANCEL_NOW');
      const fresh = await http().post('/api/job-requests').set(as('cust')).send({ categoryId: plumbing.id, issueCodes: ['blocked_drain'], addressId, when: 'NOW', idempotencyKey: key() }).expect(201);
      expect(fresh.body.urgency).toBe('urgent');
      await http().post(`/api/job-requests/${fresh.body.id}/cancel`).set(as('cust')).send({ reason: 'not-a-reason' }).expect(400);
      const c = await http().post(`/api/job-requests/${fresh.body.id}/cancel`).set(as('cust')).send({ reason: 'FOUND_SOMEONE_ELSE', note: 'neighbour helped' }).expect(201);
      expect(c.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'FOUND_SOMEONE_ELSE' });
      expect(c.body.events[c.body.events.length - 1]).toMatchObject({ type: 'CANCELLED', payload: { reason: 'FOUND_SOMEONE_ELSE', note: 'neighbour helped', by: 'customer' } });
    });

    it("another customer can neither see nor touch it", async () => {
      await http().get(`/api/job-requests/${jobId}`).set(as('other')).expect(404);
      const list = await http().get('/api/job-requests').set(as('other')).expect(200);
      expect(list.body.items.find((j: any) => j.id === jobId)).toBeUndefined();
    });
  });
});
