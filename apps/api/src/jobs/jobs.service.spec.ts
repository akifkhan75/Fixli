import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JobsService, AuthUser } from './jobs.service';

describe('JobsService', () => {
  const emit = jest.fn();
  const tx: any = {
    jobRequest: { create: jest.fn(), updateMany: jest.fn() },
    jobAiAnalysis: { updateMany: jest.fn() },
    jobEvent: { create: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn() },
  };
  const prisma: any = {
    jobRequest: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
    serviceCategory: { findFirst: jest.fn() },
    address: { findFirst: jest.fn() },
    worker: { findFirst: jest.fn() },
    jobEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage: any = { consume: jest.fn(), signedUrlForKey: jest.fn().mockResolvedValue('https://signed') };
  const realtime: any = { emitToUsers: jest.fn() };
  const notifications: any = { notify: jest.fn().mockResolvedValue(1) };
  const matching: any = { matchJob: jest.fn().mockResolvedValue(3) };
  const config: any = { get: jest.fn((k: string) => ({ REQUIRE_JOB_PHOTOS: true, AUTO_CONFIRM_HOURS: 24 } as any)[k]) };
  const svc = new JobsService(prisma, realtime, notifications, { assert: jest.fn() } as any, storage, matching, config, { record: jest.fn() } as any, { latest: jest.fn() } as any);

  const customer: AuthUser = { id: 'c1', type: 'customer' };
  const worker: AuthUser = { id: 'w1', type: 'worker' };

  beforeEach(() => {
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    storage.signedUrlForKey.mockResolvedValue('https://signed');
    tx.jobEvent.create.mockResolvedValue({ id: 'e1' });
    notifications.notify.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue({ name: 'Bilal' });
    matching.matchJob.mockResolvedValue(3);
    prisma.offer = { findUnique: jest.fn().mockResolvedValue(null) };
  });
  afterEach(() => jest.resetAllMocks());

  const category = {
    id: 'cat1', name: 'PLUMBING', translations: { en: { name: 'Plumbing' } },
    issues: [{ code: 'leaking_tap', name: 'Leaking tap' }, { code: 'pipe_burst', name: 'Burst pipe' }],
  };
  const address = { id: 'a1', userId: 'c1', streetAddress: 'House 12', area: 'Gulshan', city: 'Karachi', buildingDetail: 'Flat 3', latitude: 24.9, longitude: 67.1 };
  const dto = (over: any = {}) => ({ categoryId: 'cat1', issueCodes: ['leaking_tap'], addressId: 'a1', when: 'TODAY' as const, idempotencyKey: 'test-idemp-key', ...over });

  function primeCreate() {
    prisma.jobRequest.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ name: 'Aisha Khan', countryCode: 'PK' });
    prisma.serviceCategory.findFirst.mockResolvedValue(category);
    prisma.address.findFirst.mockResolvedValue(address);
    tx.jobRequest.create.mockResolvedValue({ id: 'j1' });
    prisma.jobRequest.findFirst.mockResolvedValue({ id: 'j1', status: 'MATCHES_FOUND', customer: { id: 'c1', name: 'Aisha Khan' }, assignedWorkerId: null, media: [], events: [] });
  }

  describe('create', () => {
    it('only customers can create', async () => {
      await expect(svc.create(worker, dto())).rejects.toThrow(ForbiddenException);
    });

    it('snapshots the saved address, builds a title, sets a time window and a first timeline event', async () => {
      primeCreate();
      await svc.create(customer, dto());
      const data = tx.jobRequest.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        customerId: 'c1', categoryId: 'cat1', title: 'Leaking tap', location: 'Flat 3, House 12, Gulshan, Karachi',
        area: 'Gulshan', city: 'Karachi', latitude: 24.9, whenOption: 'TODAY', status: 'MATCHES_FOUND', urgency: 'standard',
      });
      expect(data.scheduledFrom).toBeInstanceOf(Date);
      expect(data.events.create[0]).toMatchObject({ type: 'REQUEST_SENT', actorId: 'c1' });
    });

    it('is idempotent: the same key returns the existing job and creates nothing', async () => {
      primeCreate();
      prisma.jobRequest.findUnique.mockResolvedValue({ id: 'j-existing' });
      await svc.create(customer, dto());
      expect(tx.jobRequest.create).not.toHaveBeenCalled();
      expect(prisma.jobRequest.findFirst.mock.calls[0][0].where.AND[0]).toEqual({ id: 'j-existing' });
    });

    it('a duplicate that races past the first check still returns the one job', async () => {
      primeCreate();
      prisma.$transaction.mockRejectedValue({ code: 'P2002' });
      prisma.jobRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'j1' });
      await expect(svc.create(customer, dto())).resolves.toBeDefined();
    });

    it("rejects another customer's address, an inactive category, and unknown problems", async () => {
      primeCreate();
      prisma.address.findFirst.mockResolvedValue(null);
      await expect(svc.create(customer, dto())).rejects.toMatchObject({ response: { code: 'INVALID_ADDRESS' } });
      expect(prisma.address.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1', userId: 'c1' });

      primeCreate();
      prisma.serviceCategory.findFirst.mockResolvedValue(null);
      await expect(svc.create(customer, dto())).rejects.toMatchObject({ response: { code: 'INVALID_CATEGORY' } });

      primeCreate();
      await expect(svc.create(customer, dto({ issueCodes: ['made_up'] }))).rejects.toMatchObject({ response: { code: 'INVALID_ISSUE' } });
    });

    it('needs some description of the problem', async () => {
      primeCreate();
      await expect(svc.create(customer, dto({ issueCodes: [], description: 'x' }))).rejects.toMatchObject({ response: { code: 'DESCRIBE_PROBLEM' } });
    });

    it('rejects an impossible time with a plain message', async () => {
      primeCreate();
      await expect(svc.create(customer, dto({ when: 'SCHEDULED', date: '2020-01-01', timeSlot: 'MORNING' }))).rejects.toMatchObject({ response: { code: 'INVALID_TIME' } });
    });

    it('attaches photos and the voice note through the upload checks, inside the same transaction', async () => {
      primeCreate();
      storage.consume.mockImplementation(async (_u: string, ids: string[], purpose: string) => ids.map((i) => `${purpose.toLowerCase()}/c1/${i}`));
      await svc.create(customer, dto({ photoUploadIds: ['p1', 'p2'], audioUploadId: 'v1', audioTranscript: 'nal tapak raha hai' }));
      expect(storage.consume).toHaveBeenCalledWith('c1', ['p1', 'p2'], 'JOB_PHOTO', tx);
      expect(storage.consume).toHaveBeenCalledWith('c1', ['v1'], 'JOB_AUDIO', tx);
      const media = tx.jobRequest.create.mock.calls[0][0].data.media.create;
      expect(media.map((m: any) => m.kind)).toEqual(['PHOTO', 'PHOTO', 'AUDIO']);
      expect(media[2].transcript).toBe('nal tapak raha hai');
    });

    it('links the AI analysis only if it belongs to this customer', async () => {
      primeCreate();
      await svc.create(customer, dto({ analysisId: 'an1' }));
      expect(tx.jobAiAnalysis.updateMany.mock.calls[0][0].where).toEqual({ id: 'an1', ownerId: 'c1', jobRequestId: null });
    });

    it('runs matching after the job is saved, and never broadcasts to every worker', async () => {
      primeCreate();
      matching.matchJob.mockResolvedValue(3);
      await svc.create(customer, dto({ isEmergency: true, when: 'NOW' }));
      expect(matching.matchJob).toHaveBeenCalledWith('j1', 1);
      expect(realtime.emitToUsers).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('a matching failure does not lose the request (the sweeper retries)', async () => {
      primeCreate();
      matching.matchJob.mockRejectedValue(new Error('db hiccup'));
      await expect(svc.create(customer, dto())).resolves.toBeDefined();
    });
  });

  describe('what each viewer sees', () => {
    const row = (over: any = {}) => ({
      id: 'j1', status: 'MATCHES_FOUND', assignedWorkerId: null, location: 'Flat 3, House 12, Gulshan, Karachi', latitude: 24.9, longitude: 67.1, addressId: 'a1',
      area: 'Gulshan', city: 'Karachi', customerName: 'Aisha Khan', idempotencyKey: 'k', customer: { id: 'c1', name: 'Aisha Khan' },
      media: [{ id: 'm1', kind: 'PHOTO', storageKey: 'job_photo/c1/x.jpg', mime: 'image/jpeg', transcript: null, createdAt: new Date() }], events: [], ...over,
    });

    it('a worker who is not booked sees the area, not the exact address, and only a first name', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(row());
      const job: any = await svc.findById('j1', worker);
      expect(job).toMatchObject({ area: 'Gulshan', city: 'Karachi', customer: { name: 'Aisha' } });
      expect(job.location).toBeUndefined();
      expect(job.latitude).toBeUndefined();
      expect(JSON.stringify(job)).not.toMatch(/House 12|storageKey|idempotencyKey|Khan/);
      expect(job.media[0].url).toBe('https://signed');
    });

    it('the booked worker gets the exact address', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(row({ status: 'ACCEPTED', assignedWorkerId: 'w1' }));
      const job: any = await svc.findById('j1', worker);
      expect(job.location).toBe('Flat 3, House 12, Gulshan, Karachi');
      expect(job.latitude).toBe(24.9);
    });

    it('a worker merely asked (not yet accepted) still does not get it', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(row({ status: 'AWAITING_WORKER', assignedWorkerId: 'w1' }));
      expect(((await svc.findById('j1', worker)) as any).location).toBeUndefined();
    });

    it("customers see their own job in full; others' jobs are 404", async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(row());
      expect(((await svc.findById('j1', customer)) as any).location).toContain('House 12');
      prisma.jobRequest.findFirst.mockResolvedValue(null);
      await expect(svc.findById('j1', { id: 'c2', type: 'customer' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('transitions', () => {
    it('are atomic and write a timeline event', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'AWAITING_WORKER', title: 'Leaking tap', customerId: 'c1', assignedWorkerId: 'w1' }).mockResolvedValue({ id: 'j1', status: 'ACCEPTED', assignedWorkerId: 'w1', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      await svc.accept('j1', worker);
      // Both sides' screens refresh; the customer is told, once per event.
      expect(realtime.emitToUsers).toHaveBeenCalledWith(expect.arrayContaining(['c1', 'w1']), 'job.updated', { jobId: 'j1', status: 'ACCEPTED' });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'job.accepted', userIds: ['c1'], eventKey: 'job.accepted:e1', params: { title: 'Leaking tap', worker: 'Bilal' },
      }));
      expect(tx.jobRequest.updateMany.mock.calls[0][0].where.status).toBe('AWAITING_WORKER');
      expect(tx.jobEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'WORKER_ACCEPTED', fromStatus: 'AWAITING_WORKER', toStatus: 'ACCEPTED', actorId: 'w1' });
    });

    it('a lost race is a conflict and writes no event', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue({ status: 'AWAITING_WORKER' });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.accept('j1', worker)).rejects.toThrow(ConflictException);
      expect(tx.jobEvent.create).not.toHaveBeenCalled();
    });

    it('rejects illegal jumps and wrong actors', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue({ status: 'AWAITING_WORKER' });
      await expect(svc.finish('j1', worker, { photoSkipReason: 'NOT_APPLICABLE' })).rejects.toThrow(BadRequestException);
      await expect(svc.start('j1', customer)).rejects.toThrow(ForbiddenException);
    });

    it('cancel records who and why', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'MATCHES_FOUND' }).mockResolvedValue({ id: 'j1', status: 'CANCELLED', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      await svc.cancel('j1', customer, { reason: 'FOUND_SOMEONE_ELSE', note: ' cousin fixed it ' });
      // No worker yet and the customer cancelled: nobody else to tell.
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', cancelReason: 'FOUND_SOMEONE_ELSE', cancelledById: 'c1' });
      expect(tx.jobEvent.create.mock.calls[0][0].data.payload).toEqual({ reason: 'FOUND_SOMEONE_ELSE', note: 'cousin fixed it', by: 'customer' });
    });

    it('a worker declining tells the customer and frees the job (previous worker still gets the live update)', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'AWAITING_WORKER', title: 'Fan', customerId: 'c1', assignedWorkerId: 'w1' }).mockResolvedValue({ id: 'j1', status: 'MATCHES_FOUND', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      await svc.decline('j1', worker);
      expect(realtime.emitToUsers.mock.calls[0][0]).toEqual(expect.arrayContaining(['c1', 'w1']));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.declined', userIds: ['c1'] }));
    });

    it('a worker cancelling tells the customer, not themselves', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'ACCEPTED', title: 'Fan', customerId: 'c1', assignedWorkerId: 'w1' }).mockResolvedValue({ id: 'j1', status: 'CANCELLED', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      await svc.cancel('j1', worker, { reason: 'OTHER' });
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'job.cancelled', userIds: ['c1'] });
    });

    it('a customer cannot cancel once work has started (a clear 409, not a generic error)', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue({ status: 'IN_PROGRESS' });
      await expect(svc.cancel('j1', customer)).rejects.toThrow(ConflictException);
    });

    it('cancelling after the worker set off is recorded as late', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'EN_ROUTE', title: 'Tap', customerId: 'c1', assignedWorkerId: 'w1' }).mockResolvedValue({ id: 'j1', status: 'CANCELLED', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.conversation = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
      await svc.cancel('j1', customer, { reason: 'TOO_SLOW' });
      expect(tx.jobEvent.create.mock.calls[0][0].data.payload).toMatchObject({ late: true, by: 'customer' });
    });

    it('start needs a before photo or a stated reason; finish an after photo or a reason', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue({ status: 'ARRIVED', title: 'Tap', customerId: 'c1', assignedWorkerId: 'w1' });
      await expect(svc.start('j1', worker, {})).rejects.toMatchObject({ response: { code: 'PHOTO_REQUIRED' } });
      await expect(svc.finish('j1', worker, {})).rejects.toMatchObject({ response: { code: 'PHOTO_REQUIRED' } });
      expect(tx.jobRequest.updateMany).not.toHaveBeenCalled();
    });

    it('finishing starts the auto-confirm clock and asks the customer to check the work', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'IN_PROGRESS', title: 'Tap', customerId: 'c1', assignedWorkerId: 'w1' }).mockResolvedValue({ id: 'j1', status: 'AWAITING_CONFIRMATION', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.conversation = { findFirst: jest.fn().mockResolvedValue({ id: 'cv1' }), create: jest.fn(), update: jest.fn() };
      tx.message = { create: jest.fn() };
      await svc.finish('j1', worker, { photoSkipReason: 'CUSTOMER_DECLINED' });
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'AWAITING_CONFIRMATION', finishedAt: expect.any(Date) });
      expect(tx.jobEvent.create.mock.calls[0][0].data.payload).toEqual({ photoSkipped: 'CUSTOMER_DECLINED' });
      expect(tx.message.create.mock.calls[0][0].data).toMatchObject({ isSystem: true, systemKey: 'job.finished' });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.awaiting_confirmation', userIds: ['c1'] }));
    });

    it('when the customer confirms, the worker is the one told', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ status: 'AWAITING_CONFIRMATION', title: 'Tap', customerId: 'c1', assignedWorkerId: 'w1' }).mockResolvedValue({ id: 'j1', status: 'COMPLETED', customer: null, media: [], events: [] });
      tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.conversation = { findFirst: jest.fn().mockResolvedValue({ id: 'cv1' }), create: jest.fn(), update: jest.fn() };
      tx.message = { create: jest.fn() };
      await svc.confirm('j1', customer);
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(Date) });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.confirmed', userIds: ['w1'] }));
    });
  });

  describe('lists', () => {
    it('workers only see open requests they were matched to (not every open job)', async () => {
      prisma.jobRequest.findMany.mockResolvedValue([]);
      await svc.findAll(worker);
      expect(JSON.stringify(prisma.jobRequest.findMany.mock.calls[0][0].where)).toContain('"matches":{"some":{"workerId":"w1","declinedAt":null}}');
    });

    it('workers only query assigned or open jobs, and the result is shaped per viewer', async () => {
      prisma.jobRequest.findMany.mockResolvedValue([{ id: 'j1', status: 'MATCHES_FOUND', assignedWorkerId: null, location: 'House 12', customer: { id: 'c1', name: 'Aisha Khan' } }]);
      const res: any = await svc.findAll(worker);
      expect(JSON.stringify(prisma.jobRequest.findMany.mock.calls[0][0].where)).toContain('"assignedWorkerId":"w1"');
      expect(res.items[0].location).toBeUndefined();
    });

    it('paginates with a cursor', async () => {
      prisma.jobRequest.findMany.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({ id: `j${i}`, status: 'MATCHES_FOUND', customer: null })));
      const res = await svc.findAll(customer, { limit: 3 });
      expect(res.items).toHaveLength(3);
      expect(res.nextCursor).toBe('j2');
    });
  });
});
