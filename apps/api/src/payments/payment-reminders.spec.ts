import { prismaMock } from '../testing/prisma-mock';
import { PaymentsService } from './payments.service';

describe('cash payment reminders', () => {
  const now = new Date('2027-01-02T00:00:00Z');
  const row = (hoursAgo: number, reminderStage = 0) => ({ id: 'pay', reminderStage, markedAt: new Date(now.getTime() - hoursAgo * 3600_000), amount: 100, currency: 'PKR', jobRequestId: 'j1', jobRequest: { customerId: 'c1', title: null } });
  let prisma: any;
  const notifications = { notify: jest.fn() };
  let svc: PaymentsService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma = prismaMock();
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    svc = new PaymentsService(prisma, {} as any, {} as any, notifications as any, {} as any, {} as any, {} as any, {} as any);
  });

  it.each([[3, 1], [13, 2], [30, 3]])('%i hours after marking sends reminder %i once', async (hours, stage) => {
    prisma.payment.findMany.mockResolvedValue([row(hours)]);
    await expect(svc.remindDue(now)).resolves.toBe(1);
    expect(prisma.payment.updateMany.mock.calls[0][0].data).toEqual({ reminderStage: stage });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['c1'], eventKey: `payment.reminder:pay:${stage}` }));
  });

  it('stays quiet when someone else got there first', async () => {
    prisma.payment.findMany.mockResolvedValue([row(3)]);
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.remindDue(now)).resolves.toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
