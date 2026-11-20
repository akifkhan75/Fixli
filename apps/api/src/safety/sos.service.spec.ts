import { SosService } from './sos.service';

describe('SosService (property emergencies)', () => {
  const tx: any = { jobRequest: { updateMany: jest.fn() }, sosDispatch: { updateMany: jest.fn() }, jobEvent: { create: jest.fn() } };
  const prisma: any = {
    sosDispatch: { create: jest.fn(), findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    jobRequest: {}, jobEvent: { create: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const matching = { nearestForSos: jest.fn(), matchJob: jest.fn() };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const cfg: Record<string, unknown> = {};
  const config = { get: jest.fn((k: string) => cfg[k]) };
  let handler: (e: any) => void = () => undefined;
  const events = { on: jest.fn((_n: string, fn: any) => { handler = fn; return jest.fn(); }) };
  const make = () => new SosService(prisma, matching as any, notifications as any, realtime as any, config as any, events as any);
  const job = (status = 'MATCHES_FOUND') => ({ id: 'd1', jobRequestId: 'j1', status: 'OFFERING', attempt: 0, currentWorkerId: null, jobRequest: { id: 'j1', status, customerId: 'c1', title: 'Burst pipe', area: 'Gulshan' } });

  beforeEach(() => {
    jest.resetAllMocks();
    for (const k of Object.keys(cfg)) delete cfg[k];
    config.get.mockImplementation((k: string) => cfg[k]);
    events.on.mockImplementation((_n: string, fn: any) => { handler = fn; return jest.fn(); });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.sosDispatch.updateMany.mockResolvedValue({ count: 1 });
    prisma.sosDispatch.create.mockResolvedValue({ id: 'd1' });
    prisma.sosDispatch.updateMany.mockResolvedValue({ count: 1 });
    matching.nearestForSos.mockResolvedValue({ workerId: 'w1', distanceKm: 1.2 });
  });

  it('start: offers to the single nearest worker and tells the customer and that worker', async () => {
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job());
    await make().start('j1', 'i1');
    expect(matching.nearestForSos).toHaveBeenCalledWith('j1', 1);
    expect(tx.jobRequest.updateMany.mock.calls[0][0].data).toEqual({ status: 'AWAITING_WORKER', assignedWorkerId: 'w1' });
    expect(tx.jobEvent.create.mock.calls[0][0].data.type).toBe('SOS_OFFERED');
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'job.sos_request', userIds: ['w1'], params: { minutes: 3, distance: 1.2 } });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1', 'w1'], 'job.updated', expect.anything());
  });

  it('nobody nearby: falls back to normal offers once and tells the customer', async () => {
    matching.nearestForSos.mockResolvedValue(null);
    matching.matchJob.mockResolvedValue(4);
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job());
    await make().start('j1', null);
    expect(prisma.sosDispatch.updateMany.mock.calls[0][0].data.status).toBe('FALLBACK');
    expect(matching.matchJob).toHaveBeenCalledWith('j1', 1);
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'sos.searching_wider', userIds: ['c1'] });
  });

  it('falls back after the configured number of direct tries', async () => {
    cfg.SOS_DIRECT_TRIES = 1;
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue({ ...job(), attempt: 1 });
    matching.matchJob.mockResolvedValue(0);
    await make().start('j1', null);
    expect(matching.nearestForSos).not.toHaveBeenCalled();
    expect(matching.matchJob).toHaveBeenCalled();
  });

  it('a lost fallback race (already moved on) does nothing more', async () => {
    matching.nearestForSos.mockResolvedValue(null);
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job());
    prisma.sosDispatch.updateMany.mockResolvedValue({ count: 0 });
    await make().start('j1', null);
    expect(matching.matchJob).not.toHaveBeenCalled();
  });

  it('a job already with a worker waits; a cancelled or booked one closes the dispatch', async () => {
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job('AWAITING_WORKER'));
    await make().start('j1', null);
    expect(prisma.sosDispatch.updateMany).not.toHaveBeenCalled();
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job('CANCELLED'));
    await make().start('j1', null);
    expect(prisma.sosDispatch.updateMany.mock.calls[0][0].data.status).toBe('CANCELLED');
    prisma.sosDispatch.updateMany.mockClear();
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job('ACCEPTED'));
    await make().start('j1', null);
    expect(prisma.sosDispatch.updateMany.mock.calls[0][0].data.status).toBe('ACCEPTED');
  });

  it('a dispatch that is no longer offering is left alone', async () => {
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue({ ...job(), status: 'ACCEPTED' });
    await make().start('j1', null);
    expect(matching.nearestForSos).not.toHaveBeenCalled();
  });

  it('if the job was taken meanwhile, or the dispatch changed, nobody is notified', async () => {
    prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue(job());
    tx.jobRequest.updateMany.mockResolvedValue({ count: 0 });
    await make().start('j1', null);
    expect(notifications.notify).not.toHaveBeenCalled();
    tx.jobRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.sosDispatch.updateMany.mockResolvedValue({ count: 0 });
    await make().start('j1', null);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  describe('answers', () => {
    it('accept marks it accepted; unknown or finished dispatches are ignored', async () => {
      const s = make();
      prisma.sosDispatch.findUnique.mockResolvedValue(null);
      await s.onAnswer('j1', 'w1', true);
      prisma.sosDispatch.findUnique.mockResolvedValue({ id: 'd1', status: 'ACCEPTED' });
      await s.onAnswer('j1', 'w1', true);
      expect(prisma.sosDispatch.updateMany).not.toHaveBeenCalled();
      prisma.sosDispatch.findUnique.mockResolvedValue({ id: 'd1', status: 'OFFERING', currentWorkerId: 'w1' });
      await s.onAnswer('j1', 'w1', true);
      expect(prisma.sosDispatch.updateMany.mock.calls[0][0].data.status).toBe('ACCEPTED');
    });

    it('decline moves to the next nearest; a stale decline (offer already moved on) is ignored', async () => {
      const s = make();
      prisma.sosDispatch.findUnique.mockResolvedValue({ id: 'd1', status: 'OFFERING', currentWorkerId: 'w2' });
      await s.onAnswer('j1', 'w1', false);
      expect(matching.nearestForSos).not.toHaveBeenCalled();
      prisma.sosDispatch.findUnique.mockResolvedValue({ id: 'd1', status: 'OFFERING', currentWorkerId: 'w1' });
      prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue({ ...job(), attempt: 1 });
      await s.onAnswer('j1', 'w1', false);
      expect(matching.nearestForSos).toHaveBeenCalledWith('j1', 2);
    });

    it('the domain event reaches onAnswer, and errors are logged not thrown', async () => {
      const s = make();
      prisma.sosDispatch.findUnique.mockRejectedValue(new Error('boom'));
      expect(() => handler({ jobId: 'j1', workerId: 'w1', accepted: true })).not.toThrow();
      await new Promise((r) => setImmediate(r));
      s.onModuleDestroy();
    });
  });

  describe('expireDue', () => {
    it('puts timed-out offers back, tells the worker, and offers the next one', async () => {
      prisma.sosDispatch.findMany.mockResolvedValue([{ id: 'd1', jobRequestId: 'j1', currentWorkerId: 'w1', attempt: 1 }]);
      prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue({ ...job(), attempt: 1 });
      matching.nearestForSos.mockResolvedValue({ workerId: 'w2' });
      expect(await make().expireDue()).toBe(1);
      expect(tx.jobEvent.create.mock.calls[0][0].data.type).toBe('SOS_TIMED_OUT');
      expect(realtime.emitToUsers).toHaveBeenCalledWith(['w1'], 'job.updated', { jobId: 'j1' });
      expect(matching.nearestForSos).toHaveBeenCalledWith('j1', 2);
    });

    it('nothing due, or the job had already moved: counts zero', async () => {
      prisma.sosDispatch.findMany.mockResolvedValue([]);
      expect(await make().expireDue()).toBe(0);
      prisma.sosDispatch.findMany.mockResolvedValue([{ id: 'd1', jobRequestId: 'j1', currentWorkerId: null, attempt: 0 }]);
      tx.jobRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.sosDispatch.findUniqueOrThrow.mockResolvedValue({ ...job(), status: 'FALLBACK' });
      expect(await make().expireDue()).toBe(0);
    });
  });
});
