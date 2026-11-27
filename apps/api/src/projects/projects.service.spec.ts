import { prismaMock } from '../testing/prisma-mock';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let prisma: any;
  const storage = { consume: jest.fn(), signedUrlForKey: jest.fn() };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const blocks = { between: jest.fn() };
  const matching = { invite: jest.fn() };
  const cards = { configured: false };
  let svc: ProjectsService;
  const customer = { id: 'c1', type: 'customer' };
  const worker = { id: 'w1', type: 'worker' };

  const row = (over: any = {}) => ({
    id: 'p1', customerId: 'c1', awardedWorkerId: null, status: 'OPEN', title: 'House wiring', currency: 'PKR', photoKeys: ['k1'], audioKey: 'a1', idempotencyKey: 'key', cancelledById: null,
    customer: { id: 'c1', name: 'Sara Khan' }, awardedWorker: null, latitude: 24.9, longitude: 67, location: 'House 12', addressId: 'ad1',
    milestones: [], materials: [], visits: [], reviews: [], invites: [], bids: [], ...over,
  });
  const dto = (over: any = {}) => ({ categoryId: 'cat', addressId: 'ad1', title: ' Wire it ', description: 'Six rooms', workType: 'NEW_BUILD' as const, idempotencyKey: 'key-12345', ...over });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma = prismaMock();
    storage.consume.mockResolvedValue(['k']);
    storage.signedUrlForKey.mockImplementation(async (k: string) => `https://f/${k}`);
    matching.invite.mockResolvedValue(1);
    notifications.notify.mockResolvedValue(1);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ countryCode: 'PK' });
    prisma.serviceCategory.findFirst.mockResolvedValue({ id: 'cat' });
    prisma.address.findFirst.mockResolvedValue({ id: 'ad1', streetAddress: 'House 12', area: 'Gulshan', city: 'Karachi', latitude: 1, longitude: 2 });
    prisma.project.findUnique.mockResolvedValue(null);
    prisma.projectBid.findUnique.mockResolvedValue(null);
    svc = new ProjectsService(prisma, storage as any, notifications as any, realtime as any, blocks as any, matching as any, cards as any);
  });

  describe('create', () => {
    const created = () => prisma.project.findUnique.mockResolvedValueOnce(null).mockResolvedValue(row());

    it('publishes in the customer currency and invites professionals', async () => {
      created();
      prisma.project.create.mockResolvedValue({ id: 'p1' });
      const out = await svc.create('c1', dto({ photoUploadIds: ['u1'], audioUploadId: 'u2', audioTranscript: ' hi ', suggestedMilestones: [{ title: 'a', percent: 100 }] }));
      expect(prisma.project.create.mock.calls[0][0].data).toMatchObject({ title: 'Wire it', status: 'OPEN', currency: 'PKR', area: 'Gulshan', audioTranscript: 'hi' });
      expect(matching.invite).toHaveBeenCalledWith('p1');
      expect(out.viewer).toBe('customer');
    });

    it('keeps a draft quiet and survives a matching failure', async () => {
      created();
      prisma.project.create.mockResolvedValue({ id: 'p1' });
      await svc.create('c1', dto({ draft: true }));
      expect(matching.invite).not.toHaveBeenCalled();
      created();
      matching.invite.mockRejectedValue(new Error('x'));
      await expect(svc.create('c1', dto())).resolves.toMatchObject({ id: 'p1' });
    });

    it('returns the existing project for a repeated send, including a simultaneous one', async () => {
      prisma.project.findUnique.mockResolvedValue(row());
      await svc.create('c1', dto());
      expect(prisma.project.create).not.toHaveBeenCalled();
      prisma.project.findUnique.mockReset();
      prisma.project.findUnique.mockResolvedValueOnce(null).mockResolvedValue(row());
      prisma.project.create.mockRejectedValue({ code: 'P2002' });
      await expect(svc.create('c1', dto())).resolves.toMatchObject({ id: 'p1' });
    });

    it('passes on unexpected failures', async () => {
      prisma.project.create.mockRejectedValue(new Error('db down'));
      await expect(svc.create('c1', dto())).rejects.toThrow('db down');
    });

    it('validates budget, category, address and that something was described', async () => {
      await expect(svc.create('c1', dto({ budgetMin: 2, budgetMax: 1 }))).rejects.toMatchObject({ response: { code: 'BUDGET_RANGE' } });
      await expect(svc.create('c1', dto({ description: '' }))).rejects.toMatchObject({ response: { code: 'DESCRIBE_PROJECT' } });
      prisma.address.findFirst.mockResolvedValue(null);
      await expect(svc.create('c1', dto())).rejects.toMatchObject({ response: { code: 'UNKNOWN_ADDRESS' } });
      prisma.serviceCategory.findFirst.mockResolvedValue(null);
      await expect(svc.create('c1', dto())).rejects.toMatchObject({ response: { code: 'UNKNOWN_CATEGORY' } });
    });
  });

  describe('edit and publish', () => {
    it('only the owner, and never after prices arrived', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(svc.update('c2', 'p1', {})).rejects.toMatchObject({ status: 404 });
      prisma.project.findFirst.mockResolvedValue(row());
      prisma.project.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.update('c1', 'p1', { title: 'x' })).rejects.toMatchObject({ response: { code: 'PROJECT_LOCKED' } });
      prisma.project.updateMany.mockResolvedValue({ count: 1 });
      prisma.project.findUnique.mockResolvedValue(row());
      await expect(svc.update('c1', 'p1', { title: 'New' })).resolves.toMatchObject({ id: 'p1' });
    });

    it('publishing invites once', async () => {
      prisma.project.findFirst.mockResolvedValue(row({ status: 'DRAFT' }));
      prisma.project.findUnique.mockResolvedValue(row());
      prisma.project.updateMany.mockResolvedValue({ count: 1 });
      await svc.publish('c1', 'p1');
      prisma.project.updateMany.mockResolvedValue({ count: 0 });
      await svc.publish('c1', 'p1');
      expect(matching.invite).toHaveBeenCalledTimes(1);
    });
  });

  describe('lists and views', () => {
    it('summarises stages and hides bid counts from professionals', async () => {
      const item = (id: string) => ({ id, milestones: [{ position: 0, status: 'RELEASED' }, { position: 1, status: 'PENDING' }, { position: 2, status: 'CANCELLED' }], _count: { bids: 3 } });
      prisma.project.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => item(`p${i}`)));
      const mine = await svc.listMine(customer);
      expect(mine.items).toHaveLength(20);
      expect(mine.nextCursor).toBe('p19');
      expect(mine.items[0]).toMatchObject({ bidCount: 3, stages: { total: 2, done: 1 }, currentStage: { position: 1 } });
      prisma.project.findMany.mockResolvedValue([item('a')]);
      const theirs = await svc.listMine(worker, 'cur');
      expect(theirs.items[0].bidCount).toBeUndefined();
      expect(theirs.nextCursor).toBeNull();
    });

    it('feed carries the distance and my own bid', async () => {
      prisma.projectInvite.findMany.mockResolvedValue([{ distanceKm: 3, project: { id: 'p1', bids: [{ id: 'b1' }] } }, { distanceKm: null, project: { id: 'p2', bids: [] } }]);
      expect(await svc.feed('w1')).toEqual([{ id: 'p1', distanceKm: 3, myBid: { id: 'b1' } }, { id: 'p2', distanceKm: null, myBid: null }]);
    });

    it('a candidate sees no address, name or stages; a blocked one sees nothing', async () => {
      prisma.project.findUnique.mockResolvedValue(row({ invites: [{ distanceKm: 4 }], milestones: [{ id: 'm', evidenceKeys: [], payments: [] }] }));
      const v = await svc.view(worker, 'p1');
      expect(v).toMatchObject({ viewer: 'candidate', location: null, latitude: null, customer: { name: 'Sara' }, milestones: [], distanceKm: 4 });
      blocks.between.mockResolvedValue(true);
      await expect(svc.view(worker, 'p1')).rejects.toMatchObject({ status: 404 });
    });

    it('someone not hired never learns who was, the price, or keeps the pictures', async () => {
      prisma.project.findUnique.mockResolvedValue(row({ status: 'AWARDED', awardedWorkerId: 'w2', agreedAmount: 900, description: 'rooms', invites: [{ distanceKm: 1 }] }));
      const v: any = await svc.view(worker, 'p1');
      expect(v).toMatchObject({ viewer: 'candidate', agreedAmount: null, photos: [], audioUrl: null, description: '' });
      expect(v.awardedWorkerId).toBeUndefined();
      expect(v.customerId).toBeUndefined();
    });

    it('drafts and strangers get nothing', async () => {
      await expect(svc.view(worker, 'p1')).rejects.toMatchObject({ status: 404 });
      prisma.project.findUnique.mockResolvedValue(row({ status: 'DRAFT', invites: [{}] }));
      await expect(svc.view(worker, 'p1')).rejects.toMatchObject({ status: 404 });
      prisma.project.findUnique.mockResolvedValue(row());
      await expect(svc.view({ id: 'other', type: 'customer' }, 'p1')).rejects.toMatchObject({ status: 404 });
    });

    it('only the customer receives a live payment link', async () => {
      const milestones = [{ id: 'm', evidenceKeys: ['e'], payments: [{ id: 'x', status: 'PENDING', checkoutUrl: 'https://pay', checkoutExpiresAt: new Date(Date.now() + 60_000) }, { id: 'y', status: 'EXPIRED', checkoutUrl: 'https://old', checkoutExpiresAt: null }] }];
      prisma.project.findUnique.mockResolvedValue(row({ awardedWorkerId: 'w1', milestones, audioKey: null }));
      const mine: any = await svc.view(customer, 'p1');
      expect(mine.milestones[0].payments.map((p: any) => p.checkoutUrl)).toEqual(['https://pay', null]);
      expect(mine.milestones[0].evidence).toEqual(['https://f/e']);
      const hired: any = await svc.view(worker, 'p1');
      expect(hired.viewer).toBe('hired');
      expect(hired.milestones[0].payments[0].checkoutUrl).toBeNull();
    });
  });

  describe('bids', () => {
    const ready = (over: any = {}, status = 'OPEN') => {
      prisma.worker.findUnique.mockResolvedValue({ activationStatus: 'ACTIVE', currency: 'PKR', balanceBlocked: false, user: { name: 'Ali' }, ...over });
      prisma.projectInvite.findUnique.mockResolvedValue({ project: { id: 'p1', status, customerId: 'c1', currency: 'PKR', title: 'Wiring' } });
    };
    const price = { totalAmount: 100, durationDays: 3 };

    it('requires an invite, an approved account, no block, no debt pause and an open project', async () => {
      ready(); prisma.projectInvite.findUnique.mockResolvedValue(null);
      await expect(svc.submitBid('w1', 'p1', price)).rejects.toMatchObject({ status: 404 });
      ready({ activationStatus: 'ONBOARDING' });
      await expect(svc.submitBid('w1', 'p1', price)).rejects.toMatchObject({ response: { code: 'WORKER_NOT_ACTIVE' } });
      ready({ balanceBlocked: true });
      await expect(svc.submitBid('w1', 'p1', price)).rejects.toMatchObject({ response: { code: 'COMMISSION_LIMIT' } });
      ready({}, 'AWARDED');
      await expect(svc.submitBid('w1', 'p1', price)).rejects.toMatchObject({ response: { code: 'PROJECT_CLOSED' } });
      ready(); blocks.between.mockResolvedValue(true);
      await expect(svc.submitBid('w1', 'p1', price)).rejects.toMatchObject({ status: 404 });
    });

    it('saves one stage by default and tells the customer', async () => {
      ready();
      prisma.projectBid.upsert.mockResolvedValue({ id: 'b1', totalAmount: 100, currency: 'PKR', updatedAt: new Date() });
      await svc.submitBid('w1', 'p1', { ...price, note: ' ok ' });
      expect(prisma.projectBid.upsert.mock.calls[0][0].create).toMatchObject({ note: 'ok', milestones: [{ title: 'Wiring', amount: 100 }] });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'project.bid', userIds: ['c1'] }));
    });

    it('withdraws and declines', async () => {
      prisma.projectBid.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.withdrawBid('w1', 'p1')).rejects.toMatchObject({ status: 404 });
      prisma.projectBid.updateMany.mockResolvedValue({ count: 1 });
      prisma.project.findUnique.mockResolvedValue({ customerId: 'c1' });
      await expect(svc.withdrawBid('w1', 'p1')).resolves.toEqual({ success: true });
      prisma.projectInvite.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.notInterested('w1', 'p1')).rejects.toMatchObject({ status: 404 });
      prisma.projectInvite.updateMany.mockResolvedValue({ count: 1 });
      await expect(svc.notInterested('w1', 'p1')).resolves.toEqual({ success: true });
    });

    it('lists prices with trust signals, hiding photos until hired if asked', async () => {
      prisma.project.findFirst.mockResolvedValue(row());
      const w = { id: 'w1', rating: 4, isVerified: true, experienceYears: 2, hidePhotoUntilBooked: true, businessName: null, teamSize: null, user: { name: 'Ali', profileImageUrl: 'img' }, _count: { assignedJobs: 2, projects: 1 } };
      prisma.projectBid.findMany.mockResolvedValue([{ id: 'b1', workerId: 'w1', status: 'PENDING', worker: w }, { id: 'b2', workerId: 'w1', status: 'ACCEPTED', worker: w }]);
      prisma.review.groupBy.mockResolvedValue([{ targetId: 'w1', _count: 5 }]);
      prisma.projectInvite.findMany.mockResolvedValue([{ workerId: 'w1', distanceKm: 2 }]);
      const bids = await svc.listBids('c1', 'p1');
      expect(bids.map((b) => b.worker.profileImageUrl)).toEqual([null, 'img']);
      expect(bids[0].worker).toMatchObject({ ratingCount: 5, jobsCompleted: 3, distanceKm: 2 });
    });
  });

  describe('award', () => {
    const bid = { id: 'b1', workerId: 'w1', status: 'PENDING', totalAmount: 100, updatedAt: new Date(), milestones: [{ title: 'a', amount: 40 }, { title: 'b', amount: 60 }] };
    const ready = () => {
      prisma.project.findFirst.mockResolvedValue(row());
      prisma.projectBid.findFirst.mockResolvedValue(bid);
      prisma.project.updateMany.mockResolvedValue({ count: 1 });
      prisma.projectBid.updateMany.mockResolvedValue({ count: 1 });
      prisma.projectBid.findMany.mockResolvedValue([{ id: 'b2', workerId: 'w2' }]);
      prisma.project.findUnique.mockResolvedValue(row({ awardedWorkerId: 'w1' }));
    };
    const go = (paymentMode: 'DIRECT' | 'ESCROW' = 'DIRECT') => svc.award('c1', 'p1', { bidId: 'b1', paymentMode });

    it('creates the stages and chat, and tells winner and others', async () => {
      ready();
      await go();
      expect(prisma.projectMilestone.createMany.mock.calls[0][0].data).toHaveLength(2);
      expect(prisma.conversation.create).toHaveBeenCalled();
      expect(notifications.notify.mock.calls.map((c) => c[0].type)).toEqual(['project.awarded', 'project.not_chosen']);
    });

    it('refuses unknown or blocked prices, unavailable cards, and lost races', async () => {
      ready(); prisma.projectBid.findFirst.mockResolvedValue(null);
      await expect(go()).rejects.toMatchObject({ status: 404 });
      ready(); blocks.between.mockResolvedValue(true);
      await expect(go()).rejects.toMatchObject({ response: { code: 'BLOCKED' } });
      blocks.between.mockResolvedValue(false);
      ready();
      await expect(go('ESCROW')).rejects.toMatchObject({ response: { code: 'CARD_UNAVAILABLE' } });
      prisma.project.updateMany.mockResolvedValue({ count: 0 });
      await expect(go()).rejects.toMatchObject({ response: { code: 'PROJECT_CLOSED' } });
      ready(); prisma.projectBid.updateMany.mockResolvedValue({ count: 0 });
      await expect(go()).rejects.toMatchObject({ response: { code: 'BID_CHANGED' } });
    });

    it('repeating the same hire is harmless', async () => {
      ready(); prisma.project.findFirst.mockResolvedValue(row({ awardedBidId: 'b1', awardedWorkerId: 'w1' }));
      await go();
      expect(prisma.project.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const p = (status: string, stages: string[] = [], over: any = {}) => prisma.project.findFirst.mockResolvedValue({ id: 'p1', customerId: 'c1', awardedWorkerId: 'w1', status, title: 't', milestones: stages.map((s) => ({ status: s })), ...over });

    it('refunds held money and tells the other side', async () => {
      p('AWARDED', ['FUNDED']);
      prisma.project.updateMany.mockResolvedValue({ count: 1 });
      await svc.cancel(customer, 'p1', ' later ');
      expect(prisma.projectPayment.updateMany.mock.calls[0][0].data).toEqual({ status: 'REFUND_PENDING' });
      expect(notifications.notify.mock.calls[0][0].userIds).toEqual(['w1']);
      p('AWARDED');
      await svc.cancel(worker, 'p1');
      expect(notifications.notify.mock.calls.at(-1)![0].userIds).toEqual(['c1']);
    });

    it('is refused when finished, mid-stage, after start (professional), or on a race', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(svc.cancel(customer, 'p1')).rejects.toMatchObject({ status: 404 });
      p('CANCELLED');
      await expect(svc.cancel(customer, 'p1')).resolves.toEqual({ success: true });
      p('COMPLETED');
      await expect(svc.cancel(customer, 'p1')).rejects.toMatchObject({ response: { code: 'PROJECT_DONE' } });
      p('IN_PROGRESS');
      await expect(svc.cancel(worker, 'p1')).rejects.toMatchObject({ response: { code: 'CANNOT_CANCEL' } });
      p('IN_PROGRESS', ['SUBMITTED']);
      await expect(svc.cancel(customer, 'p1')).rejects.toMatchObject({ response: { code: 'STAGE_IN_PROGRESS' } });
      p('AWARDED');
      prisma.project.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.cancel(customer, 'p1')).rejects.toMatchObject({ response: { code: 'STAGE_IN_PROGRESS' } });
    });
  });

  describe('materials and visits', () => {
    const open = (over: any = {}) => prisma.project.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_PROGRESS', customerId: 'c1', awardedWorkerId: 'w1', title: 't', ...over });
    const material = { name: ' wire ', quantity: 2, providedBy: 'customer' as const };

    it('are for participants of a live project', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      await expect(svc.addMaterial('x', 'p1', material)).rejects.toMatchObject({ status: 404 });
      open({ status: 'COMPLETED' });
      await expect(svc.addMaterial('c1', 'p1', material)).rejects.toMatchObject({ response: { code: 'PROJECT_CLOSED' } });
    });

    it('add, tick and remove', async () => {
      open();
      prisma.projectMaterial.count.mockResolvedValue(100);
      await expect(svc.addMaterial('c1', 'p1', material)).rejects.toMatchObject({ response: { code: 'TOO_MANY' } });
      prisma.projectMaterial.count.mockResolvedValue(0);
      await svc.addMaterial('c1', 'p1', { ...material, unit: ' m ' });
      expect(prisma.projectMaterial.create.mock.calls[0][0].data).toMatchObject({ name: 'wire', unit: 'm' });
      for (const [fn, mock] of [[() => svc.setMaterialReady('c1', 'p1', 'x', true), 'updateMany'], [() => svc.removeMaterial('c1', 'p1', 'x'), 'deleteMany']] as const) {
        prisma.projectMaterial[mock].mockResolvedValue({ count: 0 });
        await expect(fn()).rejects.toMatchObject({ status: 404 });
        prisma.projectMaterial[mock].mockResolvedValue({ count: 1 });
        await expect(fn()).resolves.toEqual({ success: true });
      }
    });

    it('plan visits in the future once someone is hired, and tell the other side', async () => {
      const at = new Date(Date.now() + 86_400_000).toISOString();
      open({ awardedWorkerId: null });
      await expect(svc.addVisit('c1', 'p1', { scheduledAt: at })).rejects.toMatchObject({ response: { code: 'NOT_HIRED' } });
      open();
      await expect(svc.addVisit('c1', 'p1', { scheduledAt: '2000-01-01T00:00:00Z' })).rejects.toMatchObject({ response: { code: 'PAST_DATE' } });
      prisma.projectVisit.create.mockResolvedValue({ id: 'v1' });
      await svc.addVisit('c1', 'p1', { scheduledAt: at });
      await svc.addVisit('w1', 'p1', { scheduledAt: at, note: ' x ' });
      expect(notifications.notify.mock.calls.map((c) => c[0].userIds)).toEqual([['w1'], ['c1']]);
      prisma.projectVisit.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.updateVisit('c1', 'p1', 'v1', 'DONE')).rejects.toMatchObject({ status: 404 });
      prisma.projectVisit.updateMany.mockResolvedValue({ count: 1 });
      await expect(svc.updateVisit('c1', 'p1', 'v1', 'DONE')).resolves.toEqual({ success: true });
    });
  });
});
