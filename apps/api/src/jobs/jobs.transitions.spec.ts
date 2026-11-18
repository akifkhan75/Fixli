import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JobsService, AuthUser } from './jobs.service';

/** Status changes: who may do what, atomicity, the timeline, and who gets told. */
describe('JobsService transitions', () => {
  const tx: any = {
    jobRequest: { updateMany: jest.fn() },
    jobEvent: { create: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
  };
  const prisma: any = {
    jobRequest: { findFirst: jest.fn(), updateMany: jest.fn() },
    worker: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    jobEvent: { create: jest.fn() },
    jobMedia: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const realtime: any = { emitToUsers: jest.fn() };
  const notifications: any = { notify: jest.fn() };
  const svc = new JobsService(prisma, realtime, notifications, {} as any, {} as any);
  const customer: AuthUser = { id: 'c1', type: 'customer' };
  const worker: AuthUser = { id: 'w1', type: 'worker' };

  const job = (status: string, over: any = {}) => ({ status, title: 'Tap', customerId: 'c1', assignedWorkerId: 'w1', ...over });
  const types = () => notifications.notify.mock.calls.map((c: any) => c[0].type);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.jobEvent.create.mockResolvedValue({ id: 'e1' });
    tx.conversation.findFirst.mockResolvedValue({ id: 'conv1' });
    prisma.user.findUnique.mockResolvedValue({ name: 'Bilal' });
    jest.spyOn(svc, 'findById').mockResolvedValue({ id: 'j1' } as any);
  });

  describe('roles', () => {
    it.each([
      ['accept', () => svc.accept('j1', customer)],
      ['enRoute', () => svc.enRoute('j1', customer)],
      ['arrive', () => svc.arrive('j1', customer)],
      ['complete', () => svc.complete('j1', customer)],
      ['start', () => svc.start('j1', customer)],
      ['finish', () => svc.finish('j1', customer)],
      ['decline', () => svc.decline('j1', customer)],
    ])('%s is for the assigned worker only', async (_n, call) => {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.jobRequest.findFirst).not.toHaveBeenCalled();
    });
    it('only a customer can confirm, edit or choose a worker', async () => {
      await expect(svc.confirm('j1', worker)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.update('j1', {} as any, worker)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.requestWorker('j1', 'w1', worker)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the transition itself', () => {
    it('404 when the job is not visible or not yours (same answer for both)', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(null);
      await expect(svc.enRoute('j1', worker)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('rejects a move the state machine does not allow', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('COMPLETED'));
      await expect(svc.enRoute('j1', worker)).rejects.toThrow();
      expect(tx.jobRequest.updateMany).not.toHaveBeenCalled();
    });
    it('is conditional on the status it read, so a simultaneous change loses', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('ACCEPTED'));
      tx.jobRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.enRoute('j1', worker)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.jobRequest.updateMany.mock.calls[0][0].where.status).toBe('ACCEPTED');
      expect(notifications.notify).not.toHaveBeenCalled();
    });
    it('records the timeline event with from/to and announces live', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('ACCEPTED'));
      await svc.enRoute('j1', worker);
      expect(tx.jobEvent.create.mock.calls[0][0].data).toMatchObject({ jobRequestId: 'j1', actorId: 'w1', type: 'EN_ROUTE', fromStatus: 'ACCEPTED', toStatus: 'EN_ROUTE' });
      expect(realtime.emitToUsers).toHaveBeenCalledWith(expect.arrayContaining(['c1', 'w1']), 'job.updated', { jobId: 'j1', status: 'EN_ROUTE' });
    });
    it('posts a system message in the job chat, creating the chat if it does not exist yet', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('ARRIVED'));
      tx.conversation.findFirst.mockResolvedValue(null);
      tx.conversation.create.mockResolvedValue({ id: 'conv9' });
      await svc.start('j1', worker);
      expect(tx.conversation.create.mock.calls[0][0].data.participants).toEqual({ connect: [{ id: 'c1' }, { id: 'w1' }] });
      expect(tx.message.create.mock.calls[0][0].data).toMatchObject({ conversationId: 'conv9', isSystem: true, text: 'The professional has started the work.' });
    });
  });

  describe('start (hazard checklist)', () => {
    it('an emergency job needs both confirmations', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue({ isEmergency: true });
      for (const dto of [undefined, { shutoffVerified: true }, { protectiveEquipment: true }, { shutoffVerified: true, protectiveEquipment: false }]) {
        await expect(svc.start('j1', worker, dto as any)).rejects.toMatchObject({ response: { code: 'HAZARD_CHECKLIST_REQUIRED' } });
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it('with the checklist done it starts, and saves the before photo', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ isEmergency: true }).mockResolvedValueOnce(job('ARRIVED'));
      await svc.start('j1', worker, { shutoffVerified: true, protectiveEquipment: true, beforePhotoKey: 'k.jpg' });
      expect(prisma.jobMedia.create.mock.calls[0][0].data).toMatchObject({ phase: 'BEFORE', storageKey: 'k.jpg', createdById: 'w1' });
      expect(types()).toEqual(['job.started']);
    });
    it('a normal job needs no checklist', async () => {
      prisma.jobRequest.findFirst.mockResolvedValueOnce({ isEmergency: false }).mockResolvedValueOnce(job('ARRIVED'));
      await expect(svc.start('j1', worker)).resolves.toBeDefined();
    });
  });

  it('finish saves the after photo', async () => {
    prisma.jobRequest.findFirst.mockResolvedValue(job('IN_PROGRESS'));
    await svc.finish('j1', worker, { afterPhotoKey: 'a.jpg' });
    expect(prisma.jobMedia.create.mock.calls[0][0].data).toMatchObject({ phase: 'AFTER', storageKey: 'a.jpg' });
  });

  it('confirm completes the job and tells the customer-side event', async () => {
    prisma.jobRequest.findFirst.mockResolvedValue(job('AWAITING_CONFIRMATION'));
    await svc.confirm('j1', customer);
    expect(tx.jobEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'WORK_COMPLETED', toStatus: 'COMPLETED' });
    expect(types()).toEqual(['job.completed']);
  });

  describe('requestWorker', () => {
    it('refuses a worker who is not approved', async () => {
      prisma.worker.findFirst.mockResolvedValue(null);
      await expect(svc.requestWorker('j1', 'w9', customer)).rejects.toBeInstanceOf(BadRequestException);
    });
    it('asks the chosen worker directly', async () => {
      prisma.worker.findFirst.mockResolvedValue({ id: 'w9' });
      prisma.jobRequest.findFirst.mockResolvedValue(job('MATCHES_FOUND', { assignedWorkerId: null }));
      await svc.requestWorker('j1', 'w9', customer);
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'AWAITING_WORKER', assignedWorkerId: 'w9' });
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.direct_request', userIds: ['w9'] }));
    });
  });

  describe('decline', () => {
    it('frees the job and tells the customer which professional passed', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('AWAITING_WORKER'));
      await svc.decline('j1', worker);
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'MATCHES_FOUND', assignedWorkerId: null });
      expect(types()).toEqual(['job.declined']);
      expect(notifications.notify.mock.calls[0][0].params.worker).toBe('Bilal');
    });
  });

  describe('cancel', () => {
    it('a customer can cancel before work starts and the worker hears about it', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('ACCEPTED'));
      await svc.cancel('j1', customer, { reason: 'TOO_SLOW', note: ' late ' } as any);
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', cancelReason: 'TOO_SLOW', cancelledById: 'c1' });
      expect(tx.jobEvent.create.mock.calls[0][0].data.payload).toMatchObject({ reason: 'TOO_SLOW', note: 'late', by: 'customer' });
      expect(notifications.notify.mock.calls.map((c: any) => c[0].userIds)).toEqual([['w1']]);
    });
    it('a customer cannot cancel once the pro is on the way (contact support)', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('EN_ROUTE'));
      await expect(svc.cancel('j1', customer)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.jobRequest.updateMany).not.toHaveBeenCalled();
    });
    it('a worker cancelling tells the customer; reason defaults to OTHER', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(job('ACCEPTED'));
      await svc.cancel('j1', worker);
      expect(tx.jobRequest.updateMany.mock.calls[0][0].data.cancelReason).toBe('OTHER');
      expect(notifications.notify.mock.calls.map((c: any) => c[0].userIds)).toEqual([['c1']]);
    });
    it('is scoped to the caller: a customer only matches their own jobs', async () => {
      prisma.jobRequest.findFirst.mockResolvedValue(null);
      await expect(svc.cancel('j1', customer)).rejects.toBeInstanceOf(NotFoundException);
      expect(JSON.stringify(prisma.jobRequest.findFirst.mock.calls[0][0].where)).toContain('"customerId":"c1"');
    });
  });

  describe('update (edit open request)', () => {
    it('only while open; a stale or foreign request is explained, not silently ignored', async () => {
      prisma.jobRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.jobRequest.findFirst.mockResolvedValue(null);
      await expect(svc.update('j1', { description: 'x' } as any, customer)).rejects.toBeInstanceOf(NotFoundException);
      prisma.jobRequest.findFirst.mockResolvedValue({ id: 'j1' });
      await expect(svc.update('j1', { description: 'x' } as any, customer)).rejects.toBeInstanceOf(ConflictException);
    });
    it('edits and logs it', async () => {
      prisma.jobRequest.updateMany.mockResolvedValue({ count: 1 });
      await svc.update('j1', { description: 'new' } as any, customer);
      expect(prisma.jobRequest.updateMany.mock.calls[0][0].where.status).toEqual({ in: ['CREATED', 'MATCHES_FOUND'] });
      expect(prisma.jobEvent.create.mock.calls[0][0].data.type).toBe('DETAILS_EDITED');
    });
  });
});
