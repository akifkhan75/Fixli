import { prismaMock } from '../testing/prisma-mock';
import { nextDate, RecurringJobsService } from './recurring-jobs.service';
import { RecurringJobsSweeper } from './recurring-jobs.sweeper';

const d = (s: string) => new Date(s);

describe('recurring schedule dates', () => {
  it('moves forward past now by whole periods, never creating a backlog', () => {
    expect(nextDate(d('2027-01-01T09:00:00Z'), 'WEEKLY', d('2027-01-20T00:00:00Z'))).toEqual(d('2027-01-22T09:00:00Z'));
    expect(nextDate(d('2027-01-15T09:00:00Z'), 'QUARTERLY', d('2027-01-16T00:00:00Z'))).toEqual(d('2027-04-15T09:00:00Z'));
    expect(nextDate(d('2027-01-15T09:00:00Z'), 'YEARLY', d('2027-01-16T00:00:00Z'))).toEqual(d('2028-01-15T09:00:00Z'));
  });
  it('keeps the end of the month, and does not drift after a short month', () => {
    expect(nextDate(d('2027-01-31T09:00:00Z'), 'MONTHLY', d('2027-02-01T00:00:00Z'))).toEqual(d('2027-02-28T09:00:00Z'));
    expect(nextDate(d('2027-01-31T09:00:00Z'), 'MONTHLY', d('2027-03-01T00:00:00Z'))).toEqual(d('2027-03-31T09:00:00Z'));
  });
});

describe('running due recurring jobs', () => {
  let prisma: any;
  const matching = { matchJob: jest.fn() };
  let svc: RecurringJobsService;
  const due = { id: 'r1', frequency: 'MONTHLY', notes: null, serviceId: 's1', nextExecutionDate: d('2027-01-01T00:00:00Z'), property: { id: 'pr', userId: 'u1' }, service: { name: 'AC service', categoryId: 'cat' } };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma = prismaMock();
    prisma.recurringJob.findMany.mockResolvedValue([due]);
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Sara' });
    prisma.property.findUniqueOrThrow.mockResolvedValue({ streetAddress: 'House 1', city: 'Karachi' });
    prisma.jobRequest.create.mockResolvedValue({ id: 'j1' });
    svc = new RecurringJobsService(prisma, matching as any);
  });

  it('creates one matched request keyed by schedule and date, and moves the schedule on', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue(null);
    await expect(svc.runDue(d('2027-01-02T00:00:00Z'))).resolves.toBe(1);
    expect(prisma.jobRequest.create.mock.calls[0][0].data).toMatchObject({ idempotencyKey: 'recurring:r1:2027-01-01', categoryId: 'cat', city: 'Karachi', status: 'MATCHES_FOUND' });
    expect(matching.matchJob).toHaveBeenCalledWith('j1', 1);
    expect(prisma.recurringJob.updateMany.mock.calls[0][0].data.nextExecutionDate).toEqual(d('2027-02-01T00:00:00Z'));
  });

  it('does not create it twice, stops schedules of closed accounts, and survives a failure', async () => {
    prisma.jobRequest.findUnique.mockResolvedValue({ id: 'j1' });
    await expect(svc.runDue()).resolves.toBe(0);
    expect(prisma.recurringJob.updateMany).toHaveBeenCalled();
    prisma.user.findFirst.mockResolvedValue(null);
    await svc.runDue();
    expect(prisma.recurringJob.update.mock.calls[0][0].data).toEqual({ isActive: false });
    prisma.user.findFirst.mockRejectedValue(new Error('db'));
    await expect(svc.runDue()).resolves.toBe(0);
  });

  it('the timer runs only with the feature and background jobs on', () => {
    jest.useFakeTimers();
    const lease = { expect: jest.fn(), runExclusive: jest.fn().mockResolvedValue(0) };
    const make = (values: Record<string, unknown>) => new RecurringJobsSweeper(svc, lease as any, { get: (k: string) => values[k] } as any);
    const off = make({ RUN_BACKGROUND_JOBS: true });
    off.onModuleInit(); off.onModuleDestroy();
    expect(lease.expect).not.toHaveBeenCalled();
    const on = make({ RUN_BACKGROUND_JOBS: true, ENABLED_FEATURES: ['recurring_jobs'] });
    on.onModuleInit();
    jest.advanceTimersByTime(15 * 60_000);
    expect(lease.runExclusive).toHaveBeenCalled();
    on.onModuleDestroy();
    jest.useRealTimers();
  });
});
