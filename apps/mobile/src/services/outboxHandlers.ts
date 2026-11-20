import * as api from './api';
import { isOffline, type CreateJobInput, type JobStepEvidence, type JobView } from './api';
import { analytics } from './analytics';
import { connectivity } from './connectivity';
import { outbox, type OutboxHandler } from './outbox';
import { uploadImage } from './upload';

// ── Job steps (worker): accept, decline, on my way, arrived, start, finish ────────────────────

export type JobActionName = 'accept' | 'decline' | 'en-route' | 'arrive' | 'start' | 'finish';
export interface JobActionPayload {
  jobId: string;
  action: JobActionName;
  /** What the person pressed, in the words on the button (shown while it waits). */
  label: string;
  evidence?: JobStepEvidence & {
    /** Photos taken with no signal: uploaded first, when sending. */
    localPhotoUris?: string[];
  };
}

const AT_OR_PAST: Record<JobActionName, string[]> = {
  accept: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'],
  decline: [],
  'en-route': ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'],
  arrive: ['ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'],
  start: ['IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'],
  finish: ['AWAITING_CONFIRMATION', 'COMPLETED'],
};

/** Does the work: uploads any photos taken offline, then calls the one server action. */
export async function runJobAction(p: JobActionPayload, patch?: (c: Partial<JobActionPayload>) => Promise<void>): Promise<JobView> {
  let evidence = p.evidence;
  if (evidence?.localPhotoUris?.length) {
    const ids = [...(evidence.photoUploadIds ?? [])];
    for (const uri of evidence.localPhotoUris) ids.push((await uploadImage(uri, 'JOB_PHOTO')).id);
    evidence = { photoUploadIds: ids };
    // Remember the uploaded ids so a retry of the step itself doesn't upload the photos again.
    await patch?.({ evidence });
  }
  const { localPhotoUris: _local, ...clean } = evidence ?? {};
  switch (p.action) {
    case 'accept': return api.acceptJob(p.jobId);
    case 'decline': return api.declineJob(p.jobId);
    case 'en-route': return api.enRouteJob(p.jobId);
    case 'arrive': return api.arriveJob(p.jobId);
    case 'start': return api.startJob(p.jobId, clean);
    case 'finish': return api.finishJob(p.jobId, clean);
  }
}

export const jobActionHandler: OutboxHandler<JobActionPayload> = {
  describe: (p) => p.label,
  send: (p, ctx) => runJobAction(p, ctx.patch),
  // "Not allowed from this state" after a send we never heard back from usually means it worked.
  async alreadyDone(p, error, item) {
    if (p.action === 'decline') return error.status === 404;
    if (error.status === 404) return false;
    const job = await api.getJobView(p.jobId);
    return job.assignedWorkerId === item.userId && AT_OR_PAST[p.action].includes(job.status);
  },
};

export type SubmitResult<T> = { queued: false; result: T } | { queued: true };

/**
 * A job step from the worker's screen. With signal it happens now (and errors show right away);
 * with no signal it's saved on the phone and sent as soon as the connection is back.
 */
export async function submitJobAction(userId: string, payload: JobActionPayload): Promise<SubmitResult<JobView>> {
  if (connectivity.online) {
    try { return { queued: false, result: await runJobAction(payload) }; } catch (e) { if (!isOffline(e)) throw e; }
  }
  await outbox.add('job_action', userId, payload.jobId, payload);
  void analytics.track('outbox_queued', { kind: 'job_action' });
  return { queued: true };
}

// ── New request (customer) ───────────────────────────────────────────────────────────────────

export interface JobRequestPayload { input: CreateJobInput; title: string; /** "Book again": ask this professional first. */ workerId?: string }

export const jobRequestHandler: OutboxHandler<JobRequestPayload> = {
  describe: (p) => p.title,
  // The input carries its own idempotency key: sending twice makes one request.
  async send(p) {
    const job = await api.createJob(p.input);
    if (p.workerId) await api.requestWorkerForJob(job.id, p.workerId).catch(() => undefined);
    return job;
  },
};

/**
 * Sending a (non-emergency) request. With no signal it's saved and sent when back online; the
 * customer is told it hasn't been sent yet. Emergencies are never held back this way: they
 * need a connection to reach anyone, so the screen shows the emergency numbers instead.
 */
export async function submitJobRequest(userId: string, input: CreateJobInput, title: string, workerId?: string): Promise<SubmitResult<JobView>> {
  if (connectivity.online || input.isEmergency) {
    try { return { queued: false, result: await api.createJob(input) }; } catch (e) { if (!isOffline(e) || input.isEmergency) throw e; }
  }
  await outbox.add('job_request', userId, `request:${input.idempotencyKey}`, { input, title, workerId } satisfies JobRequestPayload, `req-${input.idempotencyKey}`);
  void analytics.track('outbox_queued', { kind: 'job_request' });
  return { queued: true };
}

export function registerOutboxHandlers() {
  outbox.register('job_action', jobActionHandler);
  outbox.register('job_request', jobRequestHandler);
}

