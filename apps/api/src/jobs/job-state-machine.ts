import { BadRequestException, ForbiddenException } from '@nestjs/common';

export type JobStatus =
  | 'CREATED'
  | 'MATCHES_FOUND'
  | 'AWAITING_WORKER'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'AWAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'CANCELLED';

export type JobActor = 'customer' | 'worker' | 'admin' | 'system';

interface Rule {
  to: JobStatus;
  actors: JobActor[];
}

/**
 * The only place that defines which job status may follow which, and who may cause it.
 * Rejecting everything not listed here is what stops a client from jumping a job to COMPLETED.
 */
export const JOB_TRANSITIONS: Record<JobStatus, Rule[]> = {
  CREATED: [
    { to: 'MATCHES_FOUND', actors: ['system'] },
    { to: 'CANCELLED', actors: ['customer', 'admin'] },
  ],
  MATCHES_FOUND: [
    // The customer picks someone, or SOS dispatch offers it to the nearest worker.
    { to: 'AWAITING_WORKER', actors: ['customer', 'system'] },
    // Customer accepts a worker's offer: the worker already committed by offering, so it is booked.
    { to: 'ACCEPTED', actors: ['customer'] },
    { to: 'CANCELLED', actors: ['customer', 'admin'] },
  ],
  AWAITING_WORKER: [
    { to: 'ACCEPTED', actors: ['worker'] },
    { to: 'MATCHES_FOUND', actors: ['worker', 'customer', 'system'] },
    { to: 'CANCELLED', actors: ['customer', 'admin'] },
  ],
  ACCEPTED: [
    { to: 'EN_ROUTE', actors: ['worker'] },
    { to: 'ARRIVED', actors: ['worker'] }, // forgot to tap "on my way"
    { to: 'IN_PROGRESS', actors: ['worker'] }, // forgot both
    { to: 'CANCELLED', actors: ['customer', 'worker', 'admin'] },
  ],
  EN_ROUTE: [
    { to: 'ARRIVED', actors: ['worker'] },
    { to: 'IN_PROGRESS', actors: ['worker'] },
    // A customer may still cancel; it is recorded as a late cancellation.
    { to: 'CANCELLED', actors: ['customer', 'worker', 'admin'] },
  ],
  ARRIVED: [
    { to: 'IN_PROGRESS', actors: ['worker'] },
    { to: 'CANCELLED', actors: ['customer', 'worker', 'admin'] },
  ],
  IN_PROGRESS: [
    { to: 'AWAITING_CONFIRMATION', actors: ['worker'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  AWAITING_CONFIRMATION: [
    // Only the customer confirms. If they don't, the system does after AUTO_CONFIRM_HOURS;
    // the worker can never complete their own job (doc 26 8.2).
    { to: 'COMPLETED', actors: ['customer', 'admin', 'system'] },
    { to: 'CANCELLED', actors: ['admin'] },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

/** Booked and not finished: the worker is committed to this job (used against double-booking). */
export const BUSY_STATUSES: JobStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];
/** Physically on a job right now: busy regardless of the booked time window. */
export const IN_FLIGHT_STATUSES: JobStatus[] = ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
/** A customer cancelling from these is a late cancellation (the worker was already on the way). */
export const LATE_CANCEL_STATUSES: JobStatus[] = ['EN_ROUTE', 'ARRIVED'];
/** Extra work may be proposed or approved only while the job is under way. */
export const CHANGE_ORDER_STATUSES: JobStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
/** The parties may see each other's phone number while booked (O7 default). */
export const CONTACT_STATUSES: JobStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];

export function canTransition(from: JobStatus, to: JobStatus, actor: JobActor): boolean {
  return !!JOB_TRANSITIONS[from]?.some((r) => r.to === to && r.actors.includes(actor));
}

export function assertTransition(from: JobStatus, to: JobStatus, actor: JobActor): void {
  const rule = JOB_TRANSITIONS[from]?.find((r) => r.to === to);
  if (!rule) {
    throw new BadRequestException({
      code: 'ILLEGAL_JOB_TRANSITION',
      message: `A job that is ${from.toLowerCase().replace(/_/g, ' ')} cannot become ${to
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
    });
  }
  if (!rule.actors.includes(actor)) {
    throw new ForbiddenException('You are not allowed to make this change to the job');
  }
}
