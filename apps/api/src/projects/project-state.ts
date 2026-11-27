import { BadRequestException } from '@nestjs/common';
import type { MilestoneStatus, ProjectPaymentMode } from '@prisma/client';

export type MilestoneActor = 'customer' | 'worker' | 'admin' | 'system';

interface Rule {
  to: MilestoneStatus;
  actors: MilestoneActor[];
  /** Only in this payment mode; both when left out. */
  mode?: ProjectPaymentMode;
}

/**
 * The only place that defines which stage status may follow which, and who may cause it. The rule
 * that protects money: nothing reaches RELEASED because the professional says so, except a direct
 * payment they confirm receiving after the customer accepted the work.
 */
export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, Rule[]> = {
  PENDING: [
    { to: 'FUNDED', actors: ['system'], mode: 'ESCROW' },
    { to: 'IN_PROGRESS', actors: ['worker'], mode: 'DIRECT' },
    { to: 'CANCELLED', actors: ['customer', 'worker', 'admin', 'system'] },
  ],
  FUNDED: [
    { to: 'IN_PROGRESS', actors: ['worker'] },
    { to: 'DISPUTED', actors: ['customer', 'worker'] },
    { to: 'CANCELLED', actors: ['customer', 'worker', 'admin', 'system'] },
  ],
  IN_PROGRESS: [
    { to: 'SUBMITTED', actors: ['worker'] },
    { to: 'DISPUTED', actors: ['customer', 'worker'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  SUBMITTED: [
    { to: 'IN_PROGRESS', actors: ['customer'] },
    { to: 'APPROVED', actors: ['customer', 'system'] },
    { to: 'DISPUTED', actors: ['customer', 'worker'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  APPROVED: [
    { to: 'RELEASED', actors: ['system', 'admin'] },
    { to: 'RELEASED', actors: ['worker'], mode: 'DIRECT' },
    { to: 'DISPUTED', actors: ['customer', 'worker'], mode: 'DIRECT' },
  ],
  DISPUTED: [
    { to: 'RELEASED', actors: ['admin'] },
    { to: 'IN_PROGRESS', actors: ['admin'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  RELEASED: [],
  CANCELLED: [],
};

export function canMove(from: MilestoneStatus, to: MilestoneStatus, actor: MilestoneActor, mode: ProjectPaymentMode): boolean {
  return MILESTONE_TRANSITIONS[from].some((r) => r.to === to && r.actors.includes(actor) && (!r.mode || r.mode === mode));
}

export function assertMove(from: MilestoneStatus, to: MilestoneStatus, actor: MilestoneActor, mode: ProjectPaymentMode): void {
  if (!canMove(from, to, actor, mode)) {
    throw new BadRequestException({ code: 'ILLEGAL_STAGE_CHANGE', message: 'This step is not possible for this stage right now. Please refresh.' });
  }
}

export const isDone = (s: MilestoneStatus) => s === 'RELEASED' || s === 'CANCELLED';

/** Stages are done in order: the current one is the first that isn't finished. */
export function currentMilestone<T extends { position: number; status: MilestoneStatus }>(milestones: T[]): T | undefined {
  return [...milestones].sort((a, b) => a.position - b.position).find((m) => !isDone(m.status));
}

/** Work or money is mid-flight: the project can't simply be cancelled. */
export const BLOCKS_CANCEL: MilestoneStatus[] = ['IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED'];

/** Largest amount one project may total: money columns are 32-bit minor units. */
export const MAX_PROJECT_AMOUNT = 2_000_000_000;
export const MAX_MILESTONES = 10;
export const MAX_PROJECT_PHOTOS = 8;
