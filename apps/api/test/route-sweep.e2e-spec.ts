import { Test } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { hasPermission, PERMISSION_KEY, ADMIN_ROLES } from '../src/common/auth/permissions';

/**
 * doc 27 F8.1: authorisation checked on EVERY route the app has, found by reading the code, so a
 * route added later is covered without anyone remembering to write a test for it.
 *
 * Per route:
 *  - no sign-in           -> 401 (unless it is marked public)
 *  - wrong kind of account -> 403 (a customer on a worker/admin route, and so on)
 *  - staff without the permission the route names -> 403, for every staff role that lacks it
 * Guards run before any validation or database work, so these calls need no valid ids or bodies.
 */
interface Route { method: string; path: string; cls: string; fn: string; isPublic: boolean; roles: string[] | undefined; permission: string | undefined }

const METHODS: Record<number, string> = { [RequestMethod.GET]: 'get', [RequestMethod.POST]: 'post', [RequestMethod.PUT]: 'put', [RequestMethod.PATCH]: 'patch', [RequestMethod.DELETE]: 'delete' };
const join = (...parts: string[]) => '/' + parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

function discover(app: INestApplication): Route[] {
  const routes: Route[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const ctrl of mod.controllers.values()) {
      const cls = ctrl.metatype as any;
      if (!cls?.prototype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, cls) ?? '';
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const fn = cls.prototype[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, fn);
        if (method === undefined || !METHODS[method]) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) ?? '';
        const get = (key: string) => Reflect.getMetadata(key, fn) ?? Reflect.getMetadata(key, cls);
        routes.push({
          method: METHODS[method],
          path: join('api', Array.isArray(base) ? base[0] : base, Array.isArray(sub) ? sub[0] : sub).replace(/:[A-Za-z]+/g, 'sweep-id'),
          cls: cls.name, fn: name,
          isPublic: !!get(IS_PUBLIC_KEY), roles: get(ROLES_KEY), permission: get(PERMISSION_KEY),
        });
      }
    }
  }
  return routes;
}

describe('Every route enforces who may call it (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let routes: Route[] = [];
  const tag = `sweep${Date.now()}`;
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  let hop = 0;

  // A different caller address per request, so the rate limit (a per-address count) never interferes.
  const call = (r: Route, token?: string) => {
    hop += 1;
    const req = (request(app.getHttpServer()) as any)[r.method](r.path).set('X-Forwarded-For', `10.${(hop >> 16) & 255}.${(hop >> 8) & 255}.${hop & 255}`);
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(r.method === 'get' ? undefined : {});
  };

  async function account(key: string, type: 'customer' | 'worker' | 'admin', roles: string[] = []) {
    const u = await prisma.user.create({ data: { name: key, email: `${tag}-${key}@t.com`, password: await bcrypt.hash('x-x-x-x-x', 4), type, adminRoles: roles } });
    userIds.push(u.id);
    const s = await prisma.session.create({ data: { userId: u.id, deviceId: `d-${tag}-${key}`, refreshTokenHash: 'x', expiresAt: new Date(Date.now() + 3600_000) } });
    tokens[key] = app.get(JwtService).sign({ sub: u.id, type, sid: s.id });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    (app as any).set('trust proxy', true);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = app.get(PrismaService);
    routes = discover(app);
    await account('customer', 'customer');
    await account('worker', 'worker');
    for (const r of ADMIN_ROLES) await account(`staff:${r}`, 'admin', [r]);
  }, 60_000);

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('finds the whole API (a sanity floor so the sweep can never quietly check nothing)', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes.filter((r) => r.roles?.includes('admin')).length).toBeGreaterThan(40);
  });

  it('every route that is not marked public refuses a caller who is not signed in', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await call(r);
      if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.path} (${r.cls}.${r.fn}) -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('the public routes are a short, known list (a new one has to be added here on purpose)', () => {
    const open = routes.filter((r) => r.isPublic).map((r) => `${r.method.toUpperCase()} ${r.path.replace('sweep-id', ':id')}`).sort();
    expect(open).toMatchSnapshot();
  });

  it('a route limited to one kind of account refuses the other kinds', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic && x.roles?.length)) {
      for (const kind of ['customer', 'worker', 'staff:Super Admin'] as const) {
        const type = kind.startsWith('staff') ? 'admin' : kind;
        if (r.roles!.includes(type as any)) continue;
        const res = await call(r, tokens[kind]);
        if (res.status !== 403) failures.push(`${kind} on ${r.method.toUpperCase()} ${r.path} (${r.cls}.${r.fn}) -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every staff route names a permission, and each staff role without it is refused', async () => {
    const failures: string[] = [];
    const staffRoutes = routes.filter((r) => !r.isPublic && r.roles?.length && r.roles.every((x) => x === 'admin'));
    expect(staffRoutes.length).toBeGreaterThan(40);
    for (const r of staffRoutes) {
      if (!r.permission) { failures.push(`${r.cls}.${r.fn} names no permission`); continue; }
      for (const role of ADMIN_ROLES) {
        if (role === 'Super Admin' || hasPermission([role], r.permission as any)) continue;
        const res = await call(r, tokens[`staff:${role}`]);
        if (res.status !== 403) failures.push(`${role} on ${r.method.toUpperCase()} ${r.path} needs ${r.permission} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
