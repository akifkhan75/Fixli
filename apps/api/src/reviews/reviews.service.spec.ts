import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const tx = {
    review: { findUnique: jest.fn(), create: jest.fn(), aggregate: jest.fn() },
    worker: { update: jest.fn() },
  };
  const prisma = { review: { findMany: jest.fn() }, $transaction: jest.fn((fn: any) => fn(tx)) };
  const access = { requireParticipant: jest.fn() };
  const svc = new ReviewsService(prisma as any, access as any);
  const job = { id: 'j1', customerId: 'c1', assignedWorkerId: 'w1', status: 'COMPLETED' };

  beforeEach(() => prisma.$transaction.mockImplementation((fn: any) => fn(tx)));
  afterEach(() => jest.resetAllMocks());

  it('strangers cannot review a job', async () => {
    access.requireParticipant.mockRejectedValue(new NotFoundException());
    await expect(svc.create({ id: 'x', type: 'customer' }, { jobRequestId: 'j1', rating: 5 })).rejects.toThrow(NotFoundException);
  });

  it('requires a completed job', async () => {
    access.requireParticipant.mockResolvedValue({ ...job, status: 'IN_PROGRESS' });
    await expect(svc.create({ id: 'c1', type: 'customer' }, { jobRequestId: 'j1', rating: 5 })).rejects.toThrow(ConflictException);
  });

  it('the reviewee is derived: customer reviews the worker, worker reviews the customer', async () => {
    access.requireParticipant.mockResolvedValue(job);
    tx.review.findUnique.mockResolvedValue(null);
    tx.review.create.mockResolvedValue({});
    tx.review.aggregate.mockResolvedValue({ _avg: { rating: 4.25 } });
    await svc.create({ id: 'c1', type: 'customer' }, { jobRequestId: 'j1', rating: 4 });
    expect(tx.review.create.mock.calls[0][0].data.targetId).toBe('w1');
    expect(tx.worker.update.mock.calls[0][0].data.rating).toBe(4.3);

    tx.worker.update.mockClear();
    await svc.create({ id: 'w1', type: 'worker' }, { jobRequestId: 'j1', rating: 5 });
    expect(tx.review.create.mock.calls[1][0].data.targetId).toBe('c1');
    expect(tx.worker.update).not.toHaveBeenCalled();
  });

  it('one review per reviewer per job', async () => {
    access.requireParticipant.mockResolvedValue(job);
    tx.review.findUnique.mockResolvedValue({ id: 'r1' });
    await expect(svc.create({ id: 'c1', type: 'customer' }, { jobRequestId: 'j1', rating: 5 })).rejects.toThrow(ConflictException);
  });

  it('admins cannot review', async () => {
    await expect(svc.create({ id: 'a', type: 'admin' }, { jobRequestId: 'j1', rating: 5 })).rejects.toThrow(ForbiddenException);
  });
});

import { needsLook } from './reviews.service';
describe('review auto-moderation', () => {
  it('flags a bare 1-star or abusive words; leaves real reviews alone', () => {
    expect(needsLook(1, '')).toBe(true);
    expect(needsLook(1, 'bad')).toBe(true);
    expect(needsLook(1, 'Came two hours late and the leak is still there.')).toBe(false);
    expect(needsLook(5, 'what an idiot')).toBe(true);
    expect(needsLook(4, 'Good work, a bit slow')).toBe(false);
  });
});
