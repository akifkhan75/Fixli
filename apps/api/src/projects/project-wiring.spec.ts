import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { prismaMock } from '../testing/prisma-mock';
import { NoCardGateway, StripeGateway } from '../payments/card.gateway';
import { LoggingSmsProvider } from '../safety/sms.provider';
import { TwilioSmsProvider } from '../safety/twilio-sms.provider';
import { createSmsProvider } from '../sms/sms.module';
import { createCardGateway } from './projects.module';
import { ProjectMatchingService } from './project-matching.service';
import { ProjectsSweeper } from './projects.sweeper';
import { ProjectsController } from './projects.controller';
import { CardWebhookController } from './card-webhook.controller';

const cfg = (values: Record<string, unknown>) => ({ get: (k: string) => values[k], getOrThrow: (k: string) => values[k] }) as any;

describe('choosing providers from settings', () => {
  it('cards: none unless Stripe is configured', () => {
    expect(createCardGateway(cfg({}))).toBeInstanceOf(NoCardGateway);
    expect(createCardGateway(cfg({ PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'w' }))).toBeInstanceOf(StripeGateway);
  });
  it('texts: logged unless Twilio is configured', () => {
    expect(createSmsProvider(cfg({}))).toBeInstanceOf(LoggingSmsProvider);
    expect(createSmsProvider(cfg({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1' }))).toBeInstanceOf(TwilioSmsProvider);
  });
});

describe('ProjectMatchingService', () => {
  let prisma: any;
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  let svc: ProjectMatchingService;
  const project = (over: any = {}) => ({ id: 'p1', status: 'OPEN', customerId: 'c1', categoryId: 'cat', latitude: 24.9, longitude: 67, city: 'Karachi', area: null, title: 't', currency: 'PKR', _count: { invites: 0 }, ...over });
  beforeEach(() => { jest.resetAllMocks(); prisma = prismaMock(); svc = new ProjectMatchingService(prisma, notifications as any, realtime as any); });

  it.each([['a missing project', null], ['a project that is not open', project({ status: 'DRAFT' })], ['a full invite list', project({ _count: { invites: 40 } })], ['no coordinates or city', project({ latitude: null, city: null })]])('invites nobody for %s', async (_n, p) => {
    prisma.project.findUnique.mockResolvedValue(p);
    await expect(svc.invite('p1')).resolves.toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('invites by distance, or by city without coordinates', async () => {
    prisma.project.findUnique.mockResolvedValue(project());
    prisma.$queryRaw.mockResolvedValue([{ id: 'w1', distance_km: 3.14 }]);
    await expect(svc.invite('p1')).resolves.toBe(1);
    expect(prisma.projectInvite.createMany.mock.calls[0][0].data).toEqual([{ projectId: 'p1', workerId: 'w1', distanceKm: 3.1 }]);
    prisma.project.findUnique.mockResolvedValue(project({ latitude: null }));
    prisma.$queryRaw.mockResolvedValue([{ id: 'w2', distance_km: null }]);
    await expect(svc.invite('p1')).resolves.toBe(1);
    expect(realtime.emitToUsers).toHaveBeenLastCalledWith(['w2'], 'feed.updated', { projectId: 'p1' });
  });
});

describe('ProjectsSweeper', () => {
  const prisma = prismaMock();
  const milestones = { autoApproveDue: jest.fn(), sendRefunds: jest.fn() };
  const matching = { invite: jest.fn() };
  const lease = { expect: jest.fn(), runExclusive: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    milestones.autoApproveDue.mockResolvedValue(1);
    milestones.sendRefunds.mockResolvedValue(2);
    matching.invite.mockResolvedValue(3);
    lease.runExclusive.mockImplementation(async (_n: string, _t: number, fn: () => unknown) => fn());
  });

  it('closes stages, refunds, and re-invites for projects short of prices at most hourly', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 'few', _count: { bids: 0 } }, { id: 'enough', _count: { bids: 3 } }]);
    const sweeper = new ProjectsSweeper(prisma, milestones as any, matching as any, lease as any, cfg({}));
    const now = new Date('2027-01-01T00:00:00Z');
    await expect(sweeper.sweep(now)).resolves.toEqual({ autoClosed: 1, refunded: 2, invited: 3 });
    expect(matching.invite).toHaveBeenCalledWith('few');
    await expect(sweeper.sweep(new Date(now.getTime() + 60_000))).resolves.toMatchObject({ invited: 0 });
  });

  it('runs on a timer only when background jobs are on', () => {
    jest.useFakeTimers();
    const off = new ProjectsSweeper(prisma, milestones as any, matching as any, lease as any, cfg({}));
    off.onModuleInit(); off.onModuleDestroy();
    expect(lease.expect).not.toHaveBeenCalled();
    const on = new ProjectsSweeper(prisma, milestones as any, matching as any, lease as any, cfg({ RUN_BACKGROUND_JOBS: true }));
    prisma.project.findMany.mockResolvedValue([]);
    on.onModuleInit();
    jest.advanceTimersByTime(60_000);
    expect(lease.runExclusive).toHaveBeenCalled();
    on.onModuleDestroy();
    jest.useRealTimers();
  });
});

describe('project routes', () => {
  const spy = () => new Proxy({}, { get: (t: any, k: string) => (t[k] ??= jest.fn().mockReturnValue(k)) }) as any;

  it('hands each request to the matching service call with the signed-in user', () => {
    const projects = spy(); const stages = spy();
    const c = new ProjectsController(projects, stages);
    const u = { id: 'u1', type: 'customer' };
    c.create('u1', {} as any); c.list(u, 'cur'); c.feed('u1'); c.view(u, 'p'); c.update('u1', 'p', {}); c.publish('u1', 'p'); c.cancel(u, 'p', { reason: 'r' });
    c.bids('u1', 'p'); c.bid('u1', 'p', {} as any); c.withdraw('u1', 'p'); c.notInterested('u1', 'p'); c.award('u1', 'p', {} as any);
    c.addMaterial('u1', 'p', {} as any); c.setMaterial('u1', 'p', 'm', { isReady: true }); c.removeMaterial('u1', 'p', 'm'); c.addVisit('u1', 'p', {} as any); c.updateVisit('u1', 'p', 'v', { status: 'DONE' });
    c.fund('u1', 's'); c.start('u1', 's'); c.submit('u1', 's', {}); c.changes('u1', 's', { note: 'n' }); c.approve('u1', 's'); c.markPaid('u1', 's'); c.dispute('u1', 's', { reason: 'r' });
    expect(projects.cancel).toHaveBeenCalledWith(u, 'p', 'r');
    expect(stages.fund).toHaveBeenCalledWith('s', 'u1');
    expect(stages.requestChanges).toHaveBeenCalledWith('s', 'u1', 'n');
  });

  it('money routes are limited to the side that owns them', () => {
    const roles = (fn: keyof ProjectsController) => Reflect.getMetadata(ROLES_KEY, ProjectsController.prototype[fn]);
    for (const fn of ['fund', 'approve', 'changes', 'award'] as const) expect(roles(fn)).toEqual(['customer']);
    for (const fn of ['start', 'submit', 'markPaid', 'bid'] as const) expect(roles(fn)).toEqual(['worker']);
  });

  it('the webhook is public, refuses what it cannot verify, and acts on real events', async () => {
    const cards = { parseWebhook: jest.fn() }; const milestones = { applyCardEvent: jest.fn() };
    const c = new CardWebhookController(cards as any, milestones as any);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CardWebhookController.prototype.webhook)).toBe(true);
    await expect(c.webhook({}, 'sig')).rejects.toBeInstanceOf(BadRequestException);
    cards.parseWebhook.mockReturnValue(null);
    await expect(c.webhook({ rawBody: Buffer.from('x') }, 'sig')).rejects.toBeInstanceOf(BadRequestException);
    cards.parseWebhook.mockReturnValue('IGNORED');
    await expect(c.webhook({ rawBody: Buffer.from('x') }, 'sig')).resolves.toEqual({ received: true, handled: false });
    cards.parseWebhook.mockReturnValue({ type: 'EXPIRED', providerRef: 'r' });
    await expect(c.webhook({ rawBody: Buffer.from('x') }, 'sig')).resolves.toEqual({ received: true, handled: true });
    expect(milestones.applyCardEvent).toHaveBeenCalled();
    expect(c.returned('success')).toContain('Payment received');
    expect(c.returned()).toContain('No money was taken');
  });
});
