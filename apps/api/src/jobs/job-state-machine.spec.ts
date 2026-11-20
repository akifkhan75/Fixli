import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertTransition, BUSY_STATUSES, canTransition, IN_FLIGHT_STATUSES, JOB_TRANSITIONS, JobActor, JobStatus } from './job-state-machine';

describe('job state machine', () => {
  it('allows the happy path in order', () => {
    assertTransition('MATCHES_FOUND', 'AWAITING_WORKER', 'customer');
    assertTransition('AWAITING_WORKER', 'ACCEPTED', 'worker');
    assertTransition('ACCEPTED', 'EN_ROUTE', 'worker');
    assertTransition('EN_ROUTE', 'ARRIVED', 'worker');
    assertTransition('ARRIVED', 'IN_PROGRESS', 'worker');
    assertTransition('IN_PROGRESS', 'AWAITING_CONFIRMATION', 'worker');
    assertTransition('AWAITING_CONFIRMATION', 'COMPLETED', 'customer');
  });

  it('rejects skipping steps (cannot jump straight to COMPLETED)', () => {
    expect(() => assertTransition('MATCHES_FOUND', 'COMPLETED', 'worker')).toThrow(BadRequestException);
    expect(() => assertTransition('ACCEPTED', 'COMPLETED', 'worker')).toThrow(BadRequestException);
  });

  it('rejects the wrong actor', () => {
    expect(() => assertTransition('ACCEPTED', 'EN_ROUTE', 'customer')).toThrow(ForbiddenException);
    expect(() => assertTransition('IN_PROGRESS', 'AWAITING_CONFIRMATION', 'customer')).toThrow(ForbiddenException);
    expect(() => assertTransition('AWAITING_WORKER', 'ACCEPTED', 'customer')).toThrow(ForbiddenException);
  });

  it('treats COMPLETED and CANCELLED as terminal', () => {
    for (const from of ['COMPLETED', 'CANCELLED'] as JobStatus[]) {
      expect(JOB_TRANSITIONS[from]).toHaveLength(0);
      expect(() => assertTransition(from, 'IN_PROGRESS', 'admin')).toThrow(BadRequestException);
    }
  });

  it('does not let a customer cancel once work has started', () => {
    expect(() => assertTransition('IN_PROGRESS', 'CANCELLED', 'customer')).toThrow(ForbiddenException);
  });

  it('only the customer, an admin, or the system (auto-confirm) completes a job; never the worker', () => {
    expect(canTransition('AWAITING_CONFIRMATION', 'COMPLETED', 'worker')).toBe(false);
    expect(canTransition('AWAITING_CONFIRMATION', 'COMPLETED', 'customer')).toBe(true);
    expect(canTransition('AWAITING_CONFIRMATION', 'COMPLETED', 'system')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'worker')).toBe(false);
    // COMPLETED is reachable only from AWAITING_CONFIRMATION.
    const into = (Object.keys(JOB_TRANSITIONS) as JobStatus[]).filter((f) => JOB_TRANSITIONS[f].some((r) => r.to === 'COMPLETED'));
    expect(into).toEqual(['AWAITING_CONFIRMATION']);
  });

  it('a customer can cancel until the work starts (on the way / arrived count as late)', () => {
    for (const s of ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as JobStatus[]) expect(canTransition(s, 'CANCELLED', 'customer')).toBe(true);
    for (const s of ['IN_PROGRESS', 'AWAITING_CONFIRMATION'] as JobStatus[]) expect(canTransition(s, 'CANCELLED', 'customer')).toBe(false);
  });

  it('every rule names a known status and actor (no typos in the table)', () => {
    const statuses = Object.keys(JOB_TRANSITIONS);
    const actors: JobActor[] = ['customer', 'worker', 'admin', 'system'];
    for (const rules of Object.values(JOB_TRANSITIONS)) {
      for (const r of rules) {
        expect(statuses).toContain(r.to);
        r.actors.forEach((a) => expect(actors).toContain(a));
      }
    }
  });

  it('a worker on the way, on site or working is busy; a finished job awaiting confirmation blocks its time window', () => {
    expect(IN_FLIGHT_STATUSES).toEqual(['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']);
    expect(BUSY_STATUSES).toEqual(expect.arrayContaining(['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION']));
  });
});
