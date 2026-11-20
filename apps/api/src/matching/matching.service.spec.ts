import { MatchingService } from './matching.service';

describe('MatchingService.matchJob', () => {
  const tx: any = { jobMatch: { createMany: jest.fn() }, jobRequest: { update: jest.fn() }, jobEvent: { create: jest.fn() } };
  const prisma: any = {
    jobRequest: { findUnique: jest.fn() },
    workingHours: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const config = { get: jest.fn() };
  const notifications = { notify: jest.fn() };
  const realtime = { emitToUsers: jest.fn() };
  const svc = new MatchingService(prisma, config as any, notifications as any, realtime as any);

  const job = (o: any = {}) => ({ id: 'j1', status: 'MATCHES_FOUND', customerId: 'c1', categoryId: 'cat', latitude: 24.9, longitude: 67.1, city: 'Karachi', area: 'Gulshan', title: 'Tap', scheduledFrom: null, scheduledTo: null, isEmergency: false, ...o });
  // Always-on hours in UTC, so availability never excludes the candidate in these tests.
  const allDay = (workerId: string) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ workerId, weekday: d, startMinute: 0, endMinute: 1440 }));
  const cand = (id: string, km: number | null, rating = 4.5) => ({ id, rating, radius: 10, timezone: 'UTC', distance_km: km, rating_count: 3 });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    config.get.mockReturnValue(undefined);
  });

  it('does nothing for a job that is gone, closed, or has no category', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(null);
    await expect(svc.matchJob('x', 1)).resolves.toBe(0);
    prisma.jobRequest.findUnique.mockResolvedValue(job({ status: 'ACCEPTED' }));
    await expect(svc.matchJob('j1', 1)).resolves.toBe(0);
    prisma.jobRequest.findUnique.mockResolvedValue(job({ categoryId: null }));
    await expect(svc.matchJob('j1', 1)).resolves.toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('notifies the nearest professionals, records the matches and tells both sides', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(job());
    prisma.$queryRaw.mockResolvedValue([cand('w1', 1.234), cand('w2', 5)]);
    prisma.workingHours.findMany.mockResolvedValue([...allDay('w1'), ...allDay('w2')]);
    const n = await svc.matchJob('j1', 1);
    expect(n).toBe(2);
    const rows = tx.jobMatch.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.workerId).sort()).toEqual(['w1', 'w2']);
    expect(rows.find((r: any) => r.workerId === 'w1').distanceKm).toBe(1.2);
    expect(tx.jobRequest.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: expect.objectContaining({ matchRound: 1 }) });
    expect(tx.jobEvent.create.mock.calls[0][0].data.type).toBe('PROFESSIONALS_NOTIFIED');
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    // Workers learn the area and distance, never the customer.
    const payload = JSON.stringify(notifications.notify.mock.calls[0][0]);
    expect(payload).not.toContain('c1');
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({ type: 'job.request', params: { area: 'Gulshan' } });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(expect.arrayContaining(['w1', 'w2']), 'feed.updated', { jobId: 'j1' });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['c1'], 'job.updated', { jobId: 'j1', status: 'MATCHES_FOUND' });
  });

  it('an emergency is offered like any request (SOS dispatch is handled by SosService)', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(job({ isEmergency: true }));
    prisma.$queryRaw.mockResolvedValue([cand('w1', 1)]);
    prisma.workingHours.findMany.mockResolvedValue(allDay('w1'));
    await svc.matchJob('j1', 1);
    expect(notifications.notify.mock.calls[0][0].type).toBe('job.request');
  });

  it('nobody nearby: records it honestly; second round also tells the customer once', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(job());
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workingHours.findMany.mockResolvedValue([]);
    await expect(svc.matchJob('j1', 1)).resolves.toBe(0);
    expect(tx.jobMatch.createMany).not.toHaveBeenCalled();
    expect(tx.jobEvent.create.mock.calls[0][0].data.type).toBe('NO_ONE_NEARBY_YET');
    expect(notifications.notify).not.toHaveBeenCalled();
    await svc.matchJob('j1', 2);
    expect(tx.jobEvent.create.mock.calls[1][0].data.type).toBe('STILL_NO_ONE');
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'job.no_one_available', userIds: ['c1'] }));
  });

  it('second round widens the radius by the configured factor', async () => {
    config.get.mockImplementation((k: string) => (k === 'REMATCH_RADIUS_FACTOR' ? 2 : undefined));
    prisma.jobRequest.findUnique.mockResolvedValue(job());
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.workingHours.findMany.mockResolvedValue([]);
    await svc.matchJob('j1', 2);
    // The factor is an interpolated parameter of the SQL (the last value before LIMIT).
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain(2);
  });

  it('a worker outside their working hours is not told', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(job());
    prisma.$queryRaw.mockResolvedValue([cand('w1', 1)]);
    prisma.workingHours.findMany.mockResolvedValue([{ workerId: 'w1', weekday: 0, startMinute: 0, endMinute: 1 }]);
    // One minute on one weekday: the job window (now, +2h) only overlaps it in the first minute after midnight UTC on Sunday.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T10:00:00Z')); // a Wednesday
    try {
      await expect(svc.matchJob('j1', 1)).resolves.toBe(0);
    } finally { jest.useRealTimers(); }
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('without GPS it falls back to the city; with neither it finds no one', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(job({ latitude: null, longitude: null }));
    prisma.$queryRaw.mockResolvedValue([cand('w1', null)]);
    prisma.workingHours.findMany.mockResolvedValue(allDay('w1'));
    await expect(svc.matchJob('j1', 1)).resolves.toBe(1);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toContain('%Karachi%');
    prisma.$queryRaw.mockClear();
    prisma.jobRequest.findUnique.mockResolvedValue(job({ latitude: null, longitude: null, city: null }));
    await expect(svc.matchJob('j1', 1)).resolves.toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
