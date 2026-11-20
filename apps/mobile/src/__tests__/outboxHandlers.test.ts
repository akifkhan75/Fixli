jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../services/socket', () => ({ realtime: { on: jest.fn(() => () => undefined) } }));
jest.mock('../services/connectivity', () => ({ connectivity: { online: true, subscribe: jest.fn(() => () => undefined) } }));
jest.mock('../services/upload', () => ({ uploadImage: jest.fn(async () => ({ id: 'up-1', url: null })) }));
jest.mock('../services/analytics', () => ({ analytics: { track: jest.fn() } }));
jest.mock('../services/api', () => {
  class ApiError extends Error { status: number; code?: string; constructor(m: string, status: number, code?: string) { super(m); this.status = status; this.code = code; } }
  return {
    ApiError,
    isOffline: (e: any) => e instanceof ApiError && e.code === 'OFFLINE',
    enRouteJob: jest.fn(), acceptJob: jest.fn(), declineJob: jest.fn(), arriveJob: jest.fn(), startJob: jest.fn(), finishJob: jest.fn(),
    createJob: jest.fn(), requestWorkerForJob: jest.fn(async () => ({})), getJobView: jest.fn(),
  };
});
import * as api from '../services/api';
import { connectivity } from '../services/connectivity';
import { outbox } from '../services/outbox';
import { jobActionHandler, registerOutboxHandlers, submitJobAction, submitJobRequest } from '../services/outboxHandlers';

const a = api as any;
const offline = () => new a.ApiError("You're offline.", 0, 'OFFLINE');
const input = (over: object = {}) => ({ categoryId: 'c', issueCodes: [], addressId: 'a', when: 'TODAY', idempotencyKey: 'k-1', ...over }) as any;

beforeAll(() => registerOutboxHandlers());
beforeEach(async () => {
  jest.clearAllMocks();
  (connectivity as any).online = true;
  await outbox.clear();
});
afterAll(() => outbox.dispose());

describe('submitJobAction', () => {
  it('with signal it just does it', async () => {
    a.enRouteJob.mockResolvedValue({ id: 'j1', status: 'EN_ROUTE' });
    const r = await submitJobAction('w1', { jobId: 'j1', action: 'en-route', label: 'On my way' });
    expect(r).toEqual({ queued: false, result: { id: 'j1', status: 'EN_ROUTE' } });
    expect(await outbox.list()).toEqual([]);
  });

  it('a server "no" is shown right away, not queued', async () => {
    a.enRouteJob.mockRejectedValue(new a.ApiError('Not allowed', 403));
    await expect(submitJobAction('w1', { jobId: 'j1', action: 'en-route', label: 'x' })).rejects.toThrow('Not allowed');
    expect(await outbox.list()).toEqual([]);
  });

  it('a request that gets no answer is saved for later', async () => {
    a.arriveJob.mockRejectedValue(offline());
    const r = await submitJobAction('w1', { jobId: 'j1', action: 'arrive', label: "I've arrived" });
    expect(r).toEqual({ queued: true });
    const [it] = await outbox.list();
    expect(it).toMatchObject({ kind: 'job_action', userId: 'w1', group: 'j1', status: 'queued' });
    expect(outbox.describe(it)).toBe("I've arrived");
  });

  it('with the phone offline it does not even try', async () => {
    (connectivity as any).online = false;
    const r = await submitJobAction('w1', { jobId: 'j1', action: 'accept', label: 'Accept job' });
    expect(r).toEqual({ queued: true });
    expect(a.acceptJob).not.toHaveBeenCalled();
  });

  it('photos taken offline are uploaded first, then the step is sent with their ids', async () => {
    a.startJob.mockResolvedValue({ id: 'j1', status: 'IN_PROGRESS' });
    const r = await submitJobAction('w1', { jobId: 'j1', action: 'start', label: 'Start work', evidence: { photoUploadIds: ['old'], localPhotoUris: ['file://a.jpg'] } });
    expect(r.queued).toBe(false);
    expect(a.startJob).toHaveBeenCalledWith('j1', { photoUploadIds: ['old', 'up-1'] });
  });
});

describe('a repeated step that already worked', () => {
  const item = { userId: 'w1' } as any;
  const err = new a.ApiError('Cannot go from EN_ROUTE', 400);
  it('counts as done when the job is already at or past it, and is mine', async () => {
    a.getJobView.mockResolvedValue({ status: 'ARRIVED', assignedWorkerId: 'w1' });
    expect(await jobActionHandler.alreadyDone!({ jobId: 'j1', action: 'en-route', label: '' }, err, item)).toBe(true);
  });
  it('does not when it is behind, or someone else has the job', async () => {
    a.getJobView.mockResolvedValue({ status: 'ACCEPTED', assignedWorkerId: 'w1' });
    expect(await jobActionHandler.alreadyDone!({ jobId: 'j1', action: 'arrive', label: '' }, err, item)).toBe(false);
    a.getJobView.mockResolvedValue({ status: 'ACCEPTED', assignedWorkerId: 'someone-else' });
    expect(await jobActionHandler.alreadyDone!({ jobId: 'j1', action: 'accept', label: '' }, err, item)).toBe(false);
  });
  it('a declined job that is gone counts as declined', async () => {
    expect(await jobActionHandler.alreadyDone!({ jobId: 'j1', action: 'decline', label: '' }, new a.ApiError('nf', 404), item)).toBe(true);
  });
});

describe('submitJobRequest', () => {
  it('sends now with signal', async () => {
    a.createJob.mockResolvedValue({ id: 'job-9' });
    expect(await submitJobRequest('c1', input(), 'Plumbing')).toEqual({ queued: false, result: { id: 'job-9' } });
  });

  it('saves a normal request when there is no signal, keyed so it can only ever make one job', async () => {
    a.createJob.mockRejectedValue(offline());
    expect(await submitJobRequest('c1', input(), 'Plumbing', 'worker-5')).toEqual({ queued: true });
    expect(await submitJobRequest('c1', input(), 'Plumbing', 'worker-5')).toEqual({ queued: true });
    const items = await outbox.list();
    expect(items).toHaveLength(1);
    expect(items[0].payload.input.idempotencyKey).toBe('k-1');
    // Back online: it goes out once, and "book again" asks that professional first.
    a.createJob.mockResolvedValue({ id: 'job-9' });
    await outbox.flush({ now: true });
    expect(a.createJob).toHaveBeenLastCalledWith(expect.objectContaining({ idempotencyKey: 'k-1' }));
    expect(a.requestWorkerForJob).toHaveBeenCalledWith('job-9', 'worker-5');
    expect(await outbox.list()).toEqual([]);
  });

  it('an emergency is never held back: the person is told to call', async () => {
    a.createJob.mockRejectedValue(offline());
    await expect(submitJobRequest('c1', input({ isEmergency: true }), 'Gas leak')).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(await outbox.list()).toEqual([]);
  });
});
