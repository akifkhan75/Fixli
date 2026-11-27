import { prismaMock } from '../testing/prisma-mock';
import { MilestonesService } from './milestones.service';

describe('MilestonesService', () => {
  let prisma: any;
  const storage = { consume: jest.fn(), signedUrlForKey: jest.fn() };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const ledger = { post: jest.fn(), notifyPaused: jest.fn() };
  const countries = { forWorker: jest.fn() };
  const events = { emit: jest.fn() };
  const config = { get: jest.fn() };
  const cards = { name: 'stripe', configured: true, createCheckout: jest.fn(), refund: jest.fn(), parseWebhook: jest.fn() };
  let svc: MilestonesService;

  const stage = (over: any = {}, project: any = {}) => ({
    id: 'm1', projectId: 'p1', position: 0, title: 'Wiring', amount: 100_000, status: 'PENDING', evidenceKeys: [],
    project: { id: 'p1', title: 'New house', status: 'IN_PROGRESS', paymentMode: 'DIRECT', currency: 'PKR', customerId: 'c1', awardedWorkerId: 'w1', ...project },
    ...over,
  });
  const load = (s: any) => {
    prisma.projectMilestone.findUnique.mockResolvedValue(s);
    prisma.projectMilestone.findMany.mockResolvedValue([{ id: s.id, position: s.position, status: s.status }]);
    prisma.projectMilestone.updateMany.mockResolvedValue({ count: 1 });
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma = prismaMock();
    countries.forWorker.mockResolvedValue({ currency: 'PKR', commission: { rateBps: 1000, minMinor: 0, maxMinor: 1_000_000 } });
    ledger.post.mockResolvedValue({ becameBlocked: false });
    config.get.mockImplementation((k: string) => ({ PUBLIC_API_URL: 'https://api', PROJECT_AUTO_APPROVE_DAYS: 7 } as any)[k]);
    prisma.projectPayment.findMany.mockResolvedValue([]);
    prisma.projectPayment.updateMany.mockResolvedValue({ count: 1 });
    prisma.project.updateMany.mockResolvedValue({ count: 1 });
    svc = new MilestonesService(prisma, storage as any, notifications as any, realtime as any, ledger as any, countries as any, events as any, config as any, cards as any);
  });

  describe('who may act', () => {
    it('hides stages from strangers and from the wrong side', async () => {
      load(stage());
      await expect(svc.start('m1', 'nobody')).rejects.toMatchObject({ status: 404 });
      await expect(svc.start('m1', 'c1')).rejects.toMatchObject({ status: 404 });
      await expect(svc.approve('m1', 'w1')).rejects.toMatchObject({ status: 404 });
      prisma.projectMilestone.findUnique.mockResolvedValue(null);
      await expect(svc.approve('m1', 'c1')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('funding', () => {
    const escrow = (over: any = {}) => stage(over, { paymentMode: 'ESCROW' });

    it('only for escrow, only while pending, only the current stage of a live project', async () => {
      load(stage());
      await expect(svc.fund('m1', 'c1')).rejects.toMatchObject({ response: { code: 'DIRECT_PAYMENT' } });
      load(escrow({ status: 'FUNDED' }));
      await expect(svc.fund('m1', 'c1')).rejects.toMatchObject({ response: { code: 'STAGE_CHANGED' } });
      load(stage({}, { paymentMode: 'ESCROW', status: 'CANCELLED' }));
      await expect(svc.fund('m1', 'c1')).rejects.toMatchObject({ response: { code: 'PROJECT_CLOSED' } });
      load(escrow({ position: 1 }));
      prisma.projectMilestone.findMany.mockResolvedValue([{ id: 'm0', position: 0, status: 'PENDING' }, { id: 'm1', position: 1, status: 'PENDING' }]);
      await expect(svc.fund('m1', 'c1')).rejects.toMatchObject({ response: { code: 'NOT_CURRENT_STAGE' } });
    });

    it('reuses an open payment page', async () => {
      load(escrow());
      prisma.projectPayment.findFirst.mockResolvedValue({ checkoutUrl: 'https://pay/1' });
      await expect(svc.fund('m1', 'c1')).resolves.toEqual({ checkoutUrl: 'https://pay/1' });
      expect(cards.createCheckout).not.toHaveBeenCalled();
    });

    it('opens a new one with a per-attempt idempotency key and records it', async () => {
      load(escrow());
      prisma.projectPayment.findFirst.mockResolvedValue(null);
      prisma.projectPayment.count.mockResolvedValue(2);
      cards.createCheckout.mockResolvedValue({ providerRef: 'cs', url: 'https://pay/2', expiresAt: new Date() });
      await expect(svc.fund('m1', 'c1')).resolves.toEqual({ checkoutUrl: 'https://pay/2' });
      expect(cards.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 100_000, idempotencyKey: 'fund:m1:3', returnUrl: 'https://api/payments/card/return' }));
      expect(prisma.projectPayment.upsert.mock.calls[0][0].create).toMatchObject({ status: 'PENDING', providerRef: 'cs', method: 'CARD' });
    });
  });

  describe('card events', () => {
    const payment = () => ({ id: 'pay1', amount: 100_000, currency: 'PKR', milestone: stage({}, { paymentMode: 'ESCROW' }) });
    const paid = { type: 'PAID' as const, providerRef: 'cs', providerPaymentId: 'pi', amountMinor: 100_000, currency: 'PKR' };

    it('ignores unknown payments', async () => {
      prisma.projectPayment.findUnique.mockResolvedValue(null);
      await svc.applyCardEvent(paid);
      expect(prisma.projectPayment.updateMany).not.toHaveBeenCalled();
    });

    it('records expiry without touching the stage', async () => {
      prisma.projectPayment.findUnique.mockResolvedValue(payment());
      await svc.applyCardEvent({ type: 'EXPIRED', providerRef: 'cs' });
      expect(prisma.projectPayment.updateMany.mock.calls[0][0].data).toEqual({ status: 'EXPIRED' });
      expect(prisma.projectMilestone.updateMany).not.toHaveBeenCalled();
    });

    it('holds the money and tells the professional', async () => {
      prisma.projectPayment.findUnique.mockResolvedValue(payment());
      prisma.projectMilestone.updateMany.mockResolvedValue({ count: 1 });
      await svc.applyCardEvent(paid);
      expect(prisma.projectPayment.update.mock.calls[0][0].data).toEqual({ status: 'HELD' });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.stage_funded', userIds: ['w1'] }));
    });

    it('does nothing the second time', async () => {
      prisma.projectPayment.findUnique.mockResolvedValue(payment());
      prisma.projectPayment.updateMany.mockResolvedValue({ count: 0 });
      await svc.applyCardEvent(paid);
      expect(prisma.projectMilestone.updateMany).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it.each([['a wrong amount', { amountMinor: 1 }, 1], ['a wrong currency', { currency: 'USD' }, 1], ['a stage no longer waiting', {}, 0]])('refunds %s', async (_n, over, count) => {
      prisma.projectPayment.findUnique.mockResolvedValue(payment());
      prisma.projectMilestone.updateMany.mockResolvedValue({ count });
      prisma.projectPayment.findMany.mockResolvedValue([{ id: 'pay1', amount: 100_000, providerPaymentId: 'pi', milestone: payment().milestone }]);
      await svc.applyCardEvent({ ...paid, ...over });
      expect(cards.refund).toHaveBeenCalledWith({ providerPaymentId: 'pi', amountMinor: 100_000, idempotencyKey: 'refund:pay1' });
      expect(prisma.projectPayment.update).not.toHaveBeenCalled();
    });

    it('keeps a refund queued when the provider is down', async () => {
      prisma.projectPayment.findMany.mockResolvedValue([{ id: 'pay1', amount: 1, providerPaymentId: 'pi', milestone: payment().milestone }]);
      cards.refund.mockRejectedValue(new Error('down'));
      await expect(svc.sendRefunds()).resolves.toBe(0);
      expect(prisma.projectPayment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('work', () => {
    it('starts the current stage and moves the project on', async () => {
      load(stage({}, { status: 'AWARDED' }));
      await expect(svc.start('m1', 'w1')).resolves.toEqual({ status: 'IN_PROGRESS' });
      expect(prisma.project.updateMany.mock.calls[0][0].data).toEqual({ status: 'IN_PROGRESS' });
    });

    it('repeating a step is harmless; losing a race is reported', async () => {
      load(stage({ status: 'IN_PROGRESS' }));
      await expect(svc.start('m1', 'w1')).resolves.toEqual({ status: 'IN_PROGRESS' });
      load(stage({ status: 'SUBMITTED' }));
      await expect(svc.submit('m1', 'w1', {})).resolves.toEqual({ status: 'SUBMITTED' });
      load(stage());
      prisma.projectMilestone.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.start('m1', 'w1')).rejects.toMatchObject({ response: { code: 'STAGE_CHANGED' } });
    });

    it('submitting needs proof, and attaches the photos', async () => {
      load(stage({ status: 'IN_PROGRESS' }));
      await expect(svc.submit('m1', 'w1', { note: '  ' })).rejects.toMatchObject({ response: { code: 'SHOW_THE_WORK' } });
      storage.consume.mockResolvedValue(['k1']);
      await svc.submit('m1', 'w1', { photoUploadIds: ['u1'] });
      expect(prisma.projectMilestone.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'SUBMITTED', evidenceKeys: ['k1'] });
    });

    it('the customer can send it back', async () => {
      load(stage({ status: 'SUBMITTED' }));
      await svc.requestChanges('m1', 'c1', ' fix it ');
      expect(prisma.projectMilestone.updateMany.mock.calls[0][0].data).toEqual({ status: 'IN_PROGRESS', changesNote: 'fix it' });
    });
  });

  describe('money', () => {
    it('direct approval books nothing yet', async () => {
      load(stage({ status: 'SUBMITTED' }));
      await expect(svc.approve('m1', 'c1')).resolves.toEqual({ status: 'APPROVED' });
      expect(ledger.post).not.toHaveBeenCalled();
      load(stage({ status: 'APPROVED' }));
      await expect(svc.approve('m1', 'c1')).resolves.toEqual({ status: 'APPROVED' });
    });

    it('escrow approval credits the money, then takes the fee, with keys per stage', async () => {
      load(stage({ status: 'SUBMITTED' }, { paymentMode: 'ESCROW' }));
      prisma.projectMilestone.findMany.mockResolvedValue([{ status: 'RELEASED' }]);
      await expect(svc.approve('m1', 'c1')).resolves.toEqual({ status: 'RELEASED' });
      expect(ledger.post.mock.calls.map((c) => [c[1].type, c[1].amount, c[1].idempotencyKey])).toEqual([
        ['ESCROW_CREDIT', -100_000, 'escrow:m1'],
        ['COMMISSION_OWED', 10_000, 'commission:stage:m1'],
      ]);
      expect(prisma.project.updateMany.mock.calls.at(-1)[0].data.status).toBe('COMPLETED');
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.completed' }));
    });

    it('refuses to release escrow that is not held', async () => {
      load(stage({ status: 'SUBMITTED' }, { paymentMode: 'ESCROW' }));
      prisma.projectPayment.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.approve('m1', 'c1')).rejects.toMatchObject({ response: { code: 'NO_MONEY_HELD' } });
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('direct "I was paid" books only the fee, and warns when that pauses new work', async () => {
      load(stage({ status: 'APPROVED' }, { currency: 'USD' }));
      prisma.projectMilestone.findMany.mockResolvedValue([{ status: 'RELEASED' }, { status: 'PENDING' }]);
      ledger.post.mockResolvedValue({ becameBlocked: true });
      await expect(svc.markPaid('m1', 'w1')).resolves.toEqual({ status: 'RELEASED' });
      expect(ledger.post).toHaveBeenCalledTimes(1);
      expect(prisma.projectPayment.create.mock.calls[0][0].data).toMatchObject({ method: 'DIRECT', commission: 10_000 });
      expect(ledger.notifyPaused).toHaveBeenCalled();
    });

    it('"I was paid" is not for escrow, and repeats are harmless', async () => {
      load(stage({ status: 'APPROVED' }, { paymentMode: 'ESCROW' }));
      await expect(svc.markPaid('m1', 'w1')).rejects.toMatchObject({ status: 403 });
      load(stage({ status: 'RELEASED' }));
      await expect(svc.markPaid('m1', 'w1')).resolves.toEqual({ status: 'RELEASED' });
    });
  });

  describe('problems', () => {
    it('opens a dispute and tells the other side and staff', async () => {
      load(stage({ status: 'IN_PROGRESS' }));
      prisma.dispute.create.mockResolvedValue({ id: 'd1' });
      await expect(svc.dispute('m1', 'w1', { reason: 'Not paid' })).resolves.toEqual({ disputeId: 'd1', status: 'DISPUTED' });
      expect(events.emit).toHaveBeenCalledWith('admin.dispute_opened', { disputeId: 'd1', projectId: 'p1' });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['c1'] }));
    });

    it('staff can release, resume or refund, only while disputed', async () => {
      load(stage({ status: 'IN_PROGRESS' }));
      await expect(svc.resolveDispute('m1', 'RELEASE')).rejects.toMatchObject({ response: { code: 'STAGE_CHANGED' } });
      load(stage({ status: 'DISPUTED' }));
      prisma.projectMilestone.findMany.mockResolvedValue([{ status: 'RELEASED' }]);
      await svc.resolveDispute('m1', 'RELEASE');
      expect(ledger.post).toHaveBeenCalled();
      load(stage({ status: 'DISPUTED' }));
      await svc.resolveDispute('m1', 'RESUME');
      expect(prisma.projectMilestone.updateMany.mock.calls.at(-1)[0].data.status).toBe('IN_PROGRESS');
      load(stage({ status: 'DISPUTED' }, { paymentMode: 'ESCROW' }));
      prisma.projectMilestone.findMany.mockResolvedValue([{ status: 'CANCELLED' }]);
      await svc.resolveDispute('m1', 'REFUND');
      expect(prisma.projectPayment.updateMany.mock.calls.at(-1)[0].data).toEqual({ status: 'REFUND_PENDING' });
      expect(prisma.project.updateMany.mock.calls.at(-1)[0].data).toEqual({ status: 'CANCELLED' });
      prisma.projectMilestone.findUnique.mockResolvedValue(null);
      await expect(svc.resolveDispute('m1', 'REFUND')).rejects.toMatchObject({ status: 404 });
    });
  });

  it('silence approves submitted work and closes old direct approvals; one failure does not stop the rest', async () => {
    const submitted = stage({ id: 'a', status: 'SUBMITTED' });
    const approved = stage({ id: 'b', status: 'APPROVED' });
    const broken = stage({ id: 'c', status: 'APPROVED' });
    prisma.projectMilestone.findMany.mockResolvedValueOnce([submitted, approved, broken]).mockResolvedValue([{ status: 'PENDING' }]);
    prisma.projectMilestone.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    await expect(svc.autoApproveDue(new Date('2027-01-20T00:00:00Z'))).resolves.toBe(2);
    expect(prisma.projectMilestone.findMany.mock.calls[0][0].where.OR[0].submittedAt.lte).toEqual(new Date('2027-01-13T00:00:00Z'));
  });
});
