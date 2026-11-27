import type { MilestoneStatus } from '@prisma/client';
import { assertMove, canMove, currentMilestone, MILESTONE_TRANSITIONS } from './project-state';

const ALL = Object.keys(MILESTONE_TRANSITIONS) as MilestoneStatus[];

describe('project stage rules', () => {
  it('never lets a professional release escrow money themselves', () => {
    for (const from of ALL) expect(canMove(from, 'RELEASED', 'worker', 'ESCROW')).toBe(false);
  });

  it('lets a professional confirm a direct payment only after the customer approved', () => {
    expect(canMove('APPROVED', 'RELEASED', 'worker', 'DIRECT')).toBe(true);
    for (const from of ALL.filter((s) => s !== 'APPROVED')) expect(canMove(from, 'RELEASED', 'worker', 'DIRECT')).toBe(false);
  });

  it('requires the money to be held before escrow work starts', () => {
    expect(canMove('PENDING', 'IN_PROGRESS', 'worker', 'ESCROW')).toBe(false);
    expect(canMove('FUNDED', 'IN_PROGRESS', 'worker', 'ESCROW')).toBe(true);
    expect(canMove('PENDING', 'IN_PROGRESS', 'worker', 'DIRECT')).toBe(true);
  });

  it('only the payment system marks a stage funded', () => {
    for (const actor of ['customer', 'worker', 'admin'] as const) expect(canMove('PENDING', 'FUNDED', actor, 'ESCROW')).toBe(false);
    expect(canMove('PENDING', 'FUNDED', 'system', 'ESCROW')).toBe(true);
  });

  it('finished stages never change again', () => {
    for (const to of ALL) for (const actor of ['customer', 'worker', 'admin', 'system'] as const) {
      expect(canMove('RELEASED', to, actor, 'ESCROW')).toBe(false);
      expect(canMove('CANCELLED', to, actor, 'DIRECT')).toBe(false);
    }
  });

  it('refuses with a plain message', () => {
    expect(() => assertMove('PENDING', 'SUBMITTED', 'worker', 'DIRECT')).toThrow(/not possible/);
  });

  it('works on stages in order, skipping finished ones', () => {
    const stages = [{ position: 2, status: 'PENDING' as const }, { position: 0, status: 'RELEASED' as const }, { position: 1, status: 'CANCELLED' as const }];
    expect(currentMilestone(stages)?.position).toBe(2);
    expect(currentMilestone([{ position: 0, status: 'RELEASED' as const }])).toBeUndefined();
  });
});
