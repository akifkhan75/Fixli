import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/** doc 27 F8.3: deleting an account really erases the sensitive files and the ID number. */
describe('Account deletion erases identity data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `priv${Date.now()}`;
  let userId: string;
  let token: string;
  const file = (key: string) => path.join(process.env.STORAGE_LOCAL_DIR ?? 'storage', key);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const u = await prisma.user.create({ data: { name: 'Priv Pro', phone: `+92301${String(Date.now()).slice(-7)}`, password: await bcrypt.hash('Blue-Tiger-42', 4), type: 'worker', countryCode: 'PK' } });
    userId = u.id;
    await prisma.worker.create({ data: { id: u.id, activationStatus: 'PENDING_REVIEW' } });
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    token = app.get(JwtService).sign({ sub: u.id, type: 'worker', sid: s.id });
  });

  afterAll(async () => {
    await prisma.verificationCase.deleteMany({ where: { workerId: userId } });
    await prisma.upload.deleteMany({ where: { ownerId: userId } });
    await prisma.worker.deleteMany({ where: { id: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('removes ID photos, selfie, avatar and the ID number, and keeps the decision history', async () => {
    const keys = [`verification/${userId}/${tag}-id-front.jpg`, `verification/${userId}/${tag}-selfie.jpg`, `avatar/${userId}/${tag}-me.jpg`];
    for (const [i, key] of keys.entries()) {
      mkdirSync(path.dirname(file(key)), { recursive: true });
      writeFileSync(file(key), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
      await prisma.upload.create({ data: { ownerId: userId, purpose: i < 2 ? 'VERIFICATION' : 'AVATAR', key, mime: 'image/jpeg', size: 4, status: 'READY', readyAt: new Date() } });
    }
    await prisma.verificationCase.create({ data: { workerId: userId, type: 'ID', status: 'APPROVED', documentKeys: keys.slice(0, 1), reference: '4210112345671' } });
    expect(keys.every((k) => existsSync(file(k)))).toBe(true);

    await request(app.getHttpServer()).post('/api/users/me/delete').set('Authorization', `Bearer ${token}`).send({ password: 'Blue-Tiger-42' }).expect(200);

    expect(keys.some((k) => existsSync(file(k)))).toBe(false);
    expect(await prisma.upload.count({ where: { ownerId: userId } })).toBe(0);
    const c = await prisma.verificationCase.findFirstOrThrow({ where: { workerId: userId } });
    expect(c).toMatchObject({ status: 'APPROVED', documentKeys: [], reference: null });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u).toMatchObject({ status: 'DELETED', name: 'Deleted user', phone: null });
  });
});
