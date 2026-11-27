// ============================================================
// Fixli API Service Layer
// Centralized API client with auth token management
// ============================================================

import type {
  IUser, IWorker, IJobRequest, IChatThread, IChatMessage,
  IServicePackage, ISubscriptionPlan, IAuthResponse,
} from '@fixli/shared';
import { hasKey, t } from '../i18n';

import { API_URL } from '../config';
import { getAccessToken, getDeviceInfo, refreshAccessToken } from './session';
import type { CountryListItem, CountryCode } from '@fixli/shared';
import { AnalyticsService } from './productAnalytics';

// ── HTTP Client ──────────────────────────────────────────────

/** No answer from the server at all (as opposed to a server "no"): safe to retry later. */
export const isOffline = (e: unknown) => e instanceof ApiError && e.code === 'OFFLINE';
/** Fire an analytics event after a call succeeds. Never carries personal data (see services/analytics). */
const tracked = <T,>(call: Promise<T>, event: string, props?: Record<string, unknown>): Promise<T> =>
  call.then((r) => { AnalyticsService.track(event, props); return r; });

export class ApiError extends Error {
  /** The sentence to show: translated when we know the error code, else the server's own words. */
  get userMessage(): string {
    return this.code && hasKey(`error.${this.code}`) ? t(`error.${this.code}`) : this.message;
  }

  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: string[],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Reads the API's standard error envelope: { success:false, error:{ code, message, details, requestId } }. */
async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  const err = body?.error;
  if (err) return new ApiError(err.message, response.status, err.code, err.details, err.requestId);
  return new ApiError(t('common.requestFailed'), response.status);
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Credential endpoints must never trigger a refresh-and-retry loop.
const NO_REFRESH = ['/auth/login/code', '/auth/login/code/start', '/auth/login', '/auth/signup', '/auth/refresh', '/auth/admin/login', '/auth/phone/start', '/auth/phone/verify', '/auth/password/forgot', '/auth/password/reset'];

async function send(endpoint: string, options: RequestInit, token?: string | null) {
  const authHeaders: Record<string, string> = token === undefined ? await getAuthHeaders() : token ? { Authorization: `Bearer ${token}` } : {};
  return fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...options.headers },
  });
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(endpoint, options);
  } catch (err: any) {
    // fetch only throws when no response came back at all (no signal, DNS, timeout): that's "offline",
    // whatever the method. Nothing is saved here; the outbox (services/outbox.ts) queues what may be queued.
    if (err instanceof TypeError || /network request failed|timed out|aborted/i.test(String(err?.message))) {
      throw new ApiError(t('common.offline'), 0, 'OFFLINE');
    }
    throw err;
  }

  // Access tokens expire every 15 minutes: refresh once, silently, and retry.
  if (response.status === 401 && !NO_REFRESH.includes(endpoint)) {
    const fresh = await refreshAccessToken();
    if (fresh) response = await send(endpoint, options, fresh);
  }

  if (!response.ok) throw await toApiError(response);
  return response.json();
}

async function requestText(endpoint: string, options: RequestInit): Promise<string> {
  let response = await send(endpoint, options);
  if (response.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) response = await send(endpoint, options, fresh);
  }
  if (!response.ok) throw await toApiError(response);
  return response.text();
}

// ── Auth ─────────────────────────────────────────────────────

export async function login(phone: string, countryCode: CountryCode, password: string): Promise<IAuthResponse> {
  return request<IAuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, countryCode, password, ...(await getDeviceInfo()) }),
  });
}

/** Passwordless sign-in: text a code, then exchange it for a session. */
export const startLoginCode = (phone: string, countryCode: CountryCode) =>
  request<OtpStarted>('/auth/login/code/start', { method: 'POST', body: JSON.stringify({ phone, countryCode }) });
export async function loginWithCode(phone: string, countryCode: CountryCode, code: string): Promise<IAuthResponse> {
  return request<IAuthResponse>('/auth/login/code', { method: 'POST', body: JSON.stringify({ phone, countryCode, code, ...(await getDeviceInfo()) }) });
}

export async function logoutRemote(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function getCountries(): Promise<CountryListItem[]> {
  return request<CountryListItem[]>('/config/countries');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request('/auth/password/change', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

export async function getCurrentUser(): Promise<IUser> {
  return request<IUser>('/auth/me');
}

export async function signup(data: {
  name: string; phone: string; countryCode: CountryCode; password: string;
  type: 'customer' | 'worker'; locale?: 'en' | 'ar' | 'ur'; signupToken?: string;
}): Promise<IAuthResponse> {
  return request<IAuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ ...data, ...(await getDeviceInfo()) }),
  });
}

export interface OtpStarted { resendInSeconds: number; expiresInMinutes: number }

/** Texts a 6-digit code. Answers the same whether or not the number already has an account. */
export const startPhoneVerification = (phone: string, countryCode: CountryCode) =>
  request<OtpStarted>('/auth/phone/start', { method: 'POST', body: JSON.stringify({ phone, countryCode }) });

/** Returns a 15-minute single-use token that signup requires. */
export const verifyPhoneCode = (phone: string, countryCode: CountryCode, code: string) =>
  request<{ signupToken: string }>('/auth/phone/verify', { method: 'POST', body: JSON.stringify({ phone, countryCode, code }) });

export const requestPasswordReset = (phone: string, countryCode: CountryCode) =>
  request<OtpStarted>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ phone, countryCode }) });

export const resetPassword = (phone: string, countryCode: CountryCode, code: string, newPassword: string) =>
  request<{ success: boolean }>('/auth/password/reset', { method: 'POST', body: JSON.stringify({ phone, countryCode, code, newPassword }) });

// ── Users ────────────────────────────────────────────────────

// ── Workers ──────────────────────────────────────────────────

export async function getWorkers(filters?: { skill?: string; minRating?: number }): Promise<IWorker[]> {
  const params = new URLSearchParams();
  if (filters?.skill) params.append('skill', filters.skill);
  if (filters?.minRating) params.append('minRating', String(filters.minRating));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<IWorker[]>(`/workers${query}`);
}

export async function getWorkerById(id: string): Promise<IWorker> {
  return request<IWorker>(`/workers/${id}`);
}

// ── Jobs ─────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function getJobRequests(filters?: {
  status?: string; serviceId?: string; limit?: number; cursor?: string;
}): Promise<Page<IJobRequest>> {
  const params = new URLSearchParams();
  if (filters?.status) params.append('status', filters.status);
  if (filters?.serviceId) params.append('serviceId', filters.serviceId);
  if (filters?.limit) params.append('limit', String(filters.limit));
  if (filters?.cursor) params.append('cursor', filters.cursor);
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<Page<IJobRequest>>(`/job-requests${query}`);
}

export interface JobEventView { id: string; type: string; fromStatus: string | null; toStatus: string | null; actorId: string | null; payload: Record<string, unknown> | null; createdAt: string }
export interface JobMediaView { id: string; kind: 'PHOTO' | 'AUDIO'; mime: string; transcript: string | null; url: string; createdAt: string }
export interface JobView {
  id: string; title: string | null; description: string; status: string; urgency: string | null; isEmergency: boolean;
  /** Only for the customer and a booked worker; workers see area/city before that. */
  location?: string | null; latitude?: number | null; longitude?: number | null;
  area: string | null; city: string | null; issueCodes: string[];
  whenOption: 'NOW' | 'TODAY' | 'TOMORROW' | 'SCHEDULED' | null; scheduledFrom: string | null; scheduledTo: string | null;
  cancelReason: string | null; createdAt: string; assignedWorkerId: string | null;
  category?: { id: string; name: string; iconName: string | null; translations?: Record<string, { name?: string }> | null } | null;
  customer?: { id: string; name: string };
  assignedWorker?: { id: string; rating?: number; isVerified?: boolean; user: { id: string; name: string; profileImageUrl?: string | null } } | null;
  media?: JobMediaView[];
  events?: JobEventView[];
  /** Booked price (integer minor units). */
  agreedAmount?: number | null;
  agreedCurrency?: string | null;
  /** Customer only: how many professionals were told; matchRound 2 = search was widened. */
  notifiedCount?: number;
  matchRound?: number;
  /** Worker only, while the request is open. */
  myOffer?: MyOffer | null;
  payments?: PaymentItem[];
  reviews?: { id: string; rating: number; comment: string | null; reviewerId: string }[];
}

export interface PaymentItem { id: string; method: string; amount: number; currency: string; status: string; createdAt: string; }

export interface MyOffer { id: string; amount: number; currency: string; etaMinutes: number | null; status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED'; expiresAt: string }

export interface OfferCard {
  id: string; amount: number; currency: string; etaMinutes: number | null; note: string | null; expiresAt: string;
  worker: { id: string; name: string; profileImageUrl: string | null; rating: number; ratingCount: number; jobsCompleted: number; isVerified: boolean; experienceYears: number; distanceKm: number | null };
}
export const listOffers = (jobId: string) => request<OfferCard[]>(`/job-requests/${jobId}/offers`);
export const acceptOffer = (offerId: string) =>
  tracked(request<{ jobId: string; status: string }>(`/offers/${offerId}/accept`, { method: 'POST' }), 'booking_confirmed');

export interface FeedItem {
  id: string; title: string | null; description: string; area: string | null; city: string | null; urgency: string | null; isEmergency: boolean;
  whenOption: JobView['whenOption']; scheduledFrom: string | null; scheduledTo: string | null; createdAt: string;
  category: JobView['category']; distanceKm: number | null; notifiedAt: string; myOffer: MyOffer | null;
}
export const getWorkerFeed = () => request<FeedItem[]>('/workers/me/requests');
export const submitOffer = (jobId: string, amount: number, etaMinutes?: number, note?: string) =>
  tracked(request<MyOffer>(`/job-requests/${jobId}/offers`, { method: 'POST', body: JSON.stringify({ amount, etaMinutes, note }) }), 'job_accepted');
export const withdrawOffer = (jobId: string) => request<{ success: boolean }>(`/job-requests/${jobId}/offers/mine`, { method: 'DELETE' });
export const notInterested = (jobId: string) => request<{ success: boolean }>(`/job-requests/${jobId}/not-interested`, { method: 'POST' });

export interface CreateJobInput {
  categoryId: string; issueCodes: string[]; description?: string;
  photoUploadIds?: string[]; audioUploadId?: string; audioTranscript?: string;
  addressId: string; when: 'NOW' | 'TODAY' | 'TOMORROW' | 'SCHEDULED'; date?: string; timeSlot?: 'MORNING' | 'AFTERNOON' | 'EVENING';
  isEmergency?: boolean; analysisId?: string; idempotencyKey: string;
}
export const createJob = (input: CreateJobInput) => request<JobView>('/job-requests', { method: 'POST', body: JSON.stringify(input) });

export type CancelReason = 'NO_LONGER_NEEDED' | 'FOUND_SOMEONE_ELSE' | 'TOO_SLOW' | 'WRONG_DETAILS' | 'OTHER';
export const cancelJobWithReason = (id: string, reason: CancelReason, note?: string) =>
  request<JobView>(`/job-requests/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason, note }) });

export interface AnalysisResult {
  analysisId: string | null;
  available: boolean;
  suggestion: null | { categoryId: string; categoryName: string; issueCodes: string[]; urgency: 'standard' | 'urgent' | 'emergency'; summary: string; confidence: number; questions: string[] };
  safety: { lifeThreatening: boolean; urgent: boolean; hazards: string[] };
}
export const analyzeRequest = (input: { description?: string; categoryId?: string; issueCodes?: string[]; photoUploadIds?: string[] }) =>
  request<AnalysisResult>('/ai/analyze', { method: 'POST', body: JSON.stringify(input) });
export const transcribeVoice = (uploadId: string, locale?: string) =>
  request<{ text: string }>('/ai/transcribe', { method: 'POST', body: JSON.stringify({ uploadId, locale }) });
export const getJobView = (id: string) => request<JobView>(`/job-requests/${id}`);
export const listJobs = (status?: string) => request<Page<JobView>>(`/job-requests${status ? `?status=${status}` : ''}`);
/** All my jobs, newest first, one page at a time. */
export const listJobsPage = (cursor?: string) => request<Page<JobView>>(`/job-requests?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
/** Booked and not finished (on the way, on site, waiting for confirmation…), or finished. */
export const listJobGroup = (group: 'active' | 'past', limit = 50, cursor?: string) =>
  request<Page<JobView>>(`/job-requests?group=${group}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);

export async function updateJobRequest(
  id: string,
  data: { description?: string; location?: string; requestedDate?: string },
): Promise<IJobRequest> {
  return request<IJobRequest>(`/job-requests/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

// Each job status change is its own server-validated action; the client never sets status directly.
export async function requestWorkerForJob(id: string, workerId: string): Promise<IJobRequest> {
  return request<IJobRequest>(`/job-requests/${id}/request-worker`, { method: 'POST', body: JSON.stringify({ workerId }) });
}
const jobAction = (action: 'accept' | 'decline' | 'en-route' | 'arrive' | 'confirm' | 'cancel') =>
  (id: string) => request<JobView>(`/job-requests/${id}/${action}`, { method: 'POST' });
export const acceptJob = jobAction('accept');
export const declineJob = jobAction('decline');
export const enRouteJob = jobAction('en-route');
export const arriveJob = jobAction('arrive');
/** Start/Finish need a photo (your JOB_PHOTO upload ids) or a reason why there isn't one. */
export interface JobStepEvidence { photoUploadIds?: string[]; photoSkipReason?: 'CAMERA_UNAVAILABLE' | 'CUSTOMER_DECLINED' | 'NOT_APPLICABLE' }
export const startJob = (id: string, evidence: JobStepEvidence) => request<JobView>(`/job-requests/${id}/start`, { method: 'POST', body: JSON.stringify(evidence) });
export const finishJob = (id: string, evidence: JobStepEvidence) => request<JobView>(`/job-requests/${id}/finish`, { method: 'POST', body: JSON.stringify(evidence) });
/** The other party's number while booked (each call is recorded). */
export const getJobContact = (id: string) => request<{ name: string | null; phone: string | null }>(`/job-requests/${id}/contact`);
export interface LiveLocation { jobId: string; latitude: number; longitude: number; heading?: number; etaMinutes: number | null; at: string }
export const getJobLocation = (id: string) => request<{ location: LiveLocation | null }>(`/job-requests/${id}/location`);
export const confirmJob = jobAction('confirm');
export const cancelJob = jobAction('cancel');

export interface ChangeOrder { id: string; jobRequestId: string; reason: string; addedScope: string; revisedPrice: number; previousPrice: number | null; currency: string; photos: string[]; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: string }
export const createChangeOrder = (data: { jobRequestId: string; reason: string; addedScope: string; revisedPrice: number; photoUploadIds?: string[] }) => request<ChangeOrder>('/change-orders', { method: 'POST', body: JSON.stringify(data) });
export const getChangeOrders = (jobId: string) => request<ChangeOrder[]>(`/change-orders/job/${jobId}`);
export const decideChangeOrder = (id: string, status: 'APPROVED' | 'REJECTED') => request<ChangeOrder>(`/change-orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

// ── Payments & Reviews ───────────────────────────────────────

/** Earned = cash customers confirmed; commission is Fixli's fee; owed is what you haven't paid Fixli yet. */
export interface Earnings {
  currency: string; period: 'week' | 'month'; periodStart: string;
  gross: number; commission: number; net: number; jobs: number;
  today: { gross: number; commission: number; net: number; jobs: number };
  owed: number; owedSince: string | null;
  limits: { softMinor: number; hardMinor: number; maxDaysOwed: number; overSoft: boolean; blocked: boolean };
  commissionRule: { rateBps: number; minMinor: number; maxMinor: number };
  settlementRails: { id: string; label: string; account: string | null }[];
  pendingSettlement: { id: string; amount: number; createdAt: string } | null;
}
export const getWorkerEarnings = (period: 'week' | 'month' = 'week') => request<Earnings>(`/workers/me/earnings?period=${period}`);
export interface LedgerItem { id: string; type: 'COMMISSION_OWED' | 'COMMISSION_SETTLED' | 'ADJUSTMENT' | 'ESCROW_CREDIT'; amount: number; currency: string; balanceAfter: number; jobRequestId: string | null; jobTitle: string | null; note: string | null; createdAt: string }
export const getLedger = (cursor?: string) => request<{ items: LedgerItem[]; nextCursor: string | null }>(`/workers/me/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const reportSettlement = (amount: number, rail: string, reference: string) =>
  request<{ id: string; status: string }>('/workers/me/settlements', { method: 'POST', body: JSON.stringify({ amount, rail, reference }) });

export interface PaymentView { id: string; method: string; amount: number; currency: string; status: 'MARKED_BY_WORKER' | 'CONFIRMED' | 'DISPUTED' | 'VOIDED' | string; createdAt: string }
/** Worker: "I received the agreed amount in cash". The amount is the job's agreed total (never typed). */
export const markCashReceived = (jobId: string) => request<PaymentView>(`/job-requests/${jobId}/payments/cash`, { method: 'POST', body: JSON.stringify({}) });
export const confirmPayment = (paymentId: string) => request<PaymentView>(`/payments/${paymentId}/confirm`, { method: 'POST' });
export const disputePayment = (paymentId: string, reason: string, claimedAmount?: number) => request<{ status: string; disputeId: string }>(`/payments/${paymentId}/dispute`, { method: 'POST', body: JSON.stringify({ reason, claimedAmount }) });

export type DisputeCategory = 'PAYMENT' | 'QUALITY' | 'DAMAGE' | 'NO_SHOW' | 'PRICE' | 'BEHAVIOUR' | 'OTHER';
export const openDispute = (data: { jobRequestId: string; category: DisputeCategory; reason: string; description?: string; evidenceUploadIds?: string[] }) =>
  request<{ id: string; status: string }>('/disputes', { method: 'POST', body: JSON.stringify(data) });

export const WORKER_REVIEW_TAGS = ['ON_TIME', 'FRIENDLY', 'CLEAN', 'FAIR_PRICE', 'SKILLED', 'EXPLAINED_WELL'] as const;
export const CUSTOMER_REVIEW_TAGS = ['RESPECTFUL', 'CLEAR_INSTRUCTIONS', 'PAID_PROMPTLY', 'EASY_ACCESS'] as const;
/** The person reviewed is always the other side of the job (the server decides; no target id). */
export const submitReview = (data: ({ jobRequestId: string } | { projectId: string }) & { rating: number; comment?: string; tags?: string[] }) =>
  request<{ id: string }>('/reviews', { method: 'POST', body: JSON.stringify(data) });

export interface FavoriteWorker { id: string; workerId: string; worker: { id: string; rating: number; user: { name: string; profileImageUrl: string | null }; services: { category: { name: string } }[] } }
export const getFavorites = () => request<FavoriteWorker[]>('/users/me/favorites');
export const addFavorite = (workerId: string) => request<{ success: boolean }>(`/users/me/favorites/${workerId}`, { method: 'POST' });
export const removeFavorite = (workerId: string) => request<{ success: boolean }>(`/users/me/favorites/${workerId}`, { method: 'DELETE' });

/** Delete my account (password required). Refused during an active job or with commission owed. */
export const deleteAccount = (password: string) => request<{ success: boolean }>('/users/me/delete', { method: 'POST', body: JSON.stringify({ password }) });
export interface LedgerSummary {
  /** Minor units; negative = you owe Fixli fees. */
  balance: number; owed: number; currency: string;
  status: 'OK' | 'WARN' | 'BLOCKED'; softLimit: number; hardLimit: number; settleDays: number;
  history: { id: string; type: string; amount: number; createdAt: string }[];
}
// ── AI ─────────────────────────────────────────────────────

export async function generateQuoteDraft(jobDescription: string, workerNotes: string): Promise<string> {
  // Plain-text response; goes through the same refresh logic as everything else.
  return requestText('/ai/quote-draft', { method: 'POST', body: JSON.stringify({ jobDescription, workerNotes }) });
}

// ── Chat ─────────────────────────────────────────────────────

export interface ChatParticipant { id: string; name: string; profileImageUrl: string | null }
export interface ConversationItem {
  id: string; job: { id: string; title: string | null; status: string } | null; project?: { id: string; title: string; status: string } | null; counterpart: ChatParticipant | null;
  lastMessage: ChatMessage | null; lastMessageAt: string | null; unreadCount: number;
  isReadOnly: boolean; closedAt: string | null; blockedByMe: boolean;
}
export interface ChatMessage {
  id: string; conversationId: string; clientId?: string | null; text: string | null; imageUrl: string | null;
  isSystem: boolean; systemKey?: string | null; createdAt: string;
  sender: { id: string; name: string } | null; reads: { userId: string; readAt: string }[];
}
export interface ConversationMeta { id: string; job: { id: string; title: string | null } | null; project?: { id: string; title: string } | null; counterpart: { id: string; name: string } | null; isReadOnly: boolean; closedAt: string | null; blocked: boolean }

export const getConversations = (cursor?: string) => request<Page<ConversationItem>>(`/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const getConversationMessages = (id: string, cursor?: string) =>
  request<Page<ChatMessage> & { conversation: ConversationMeta }>(`/conversations/${id}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
/** Idempotent by clientId: the outbox may retry safely. `warning` is a reminder for the sender only. */
export const sendChatMessage = (conversationId: string, data: { text?: string; imageUploadId?: string; clientId: string }) =>
  request<ChatMessage & { warning?: 'CONTACT_INFO' }>(`/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify(data) });
export const markMessagesAsRead = (id: string) => request<{ success: boolean }>(`/conversations/${id}/read`, { method: 'POST' });
export const conversationForJob = (jobId: string) => request<{ id: string }>(`/conversations/by-job/${jobId}`);
export const sendTyping = (id: string) => request<void>(`/conversations/${id}/typing`, { method: 'POST' }).catch(() => undefined);
export const blockInConversation = (id: string, reason?: string) => request<{ success: boolean }>(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) });
export type ReportReason = 'HARASSMENT' | 'SCAM' | 'UNSAFE' | 'INAPPROPRIATE' | 'OTHER';
export const reportInConversation = (id: string, reason: ReportReason, details?: string) =>
  request<{ success: boolean }>(`/conversations/${id}/report`, { method: 'POST', body: JSON.stringify({ reason, details }) });
export interface BlockedPerson { blockedId: string; createdAt: string; blocked: { name: string; profileImageUrl: string | null; type: string } }
export const getBlocked = () => request<BlockedPerson[]>('/users/me/blocks');
export const unblock = (userId: string) => request<{ success: boolean }>(`/users/me/blocks/${userId}`, { method: 'DELETE' });

// ── Services ─────────────────────────────────────────────────

export async function getServicePackages(): Promise<IServicePackage[]> {
  return request<IServicePackage[]>('/service-packages');
}

export async function getSubscriptionPlans(): Promise<ISubscriptionPlan[]> {
  return request<ISubscriptionPlan[]>('/subscription-plans');
}

// ── Uploads ──────────────────────────────────────────────────

export async function createUploadSlot(purpose: string, mime: string, size: number) {
  return request<{ id: string; upload: { url: string; method: string; headers: Record<string, string> } }>('/uploads', {
    method: 'POST', body: JSON.stringify({ purpose, mime, size }),
  });
}

export async function completeUpload(id: string) {
  return request<{ id: string; status: string; url: string | null }>(`/uploads/${id}/complete`, { method: 'POST' });
}

// ── Profile (customer + shared) ──────────────────────────────

export async function getMe(): Promise<IUser> {
  return request<IUser>('/users/me');
}

export async function updateMe(data: { name?: string; locale?: 'en' | 'ar' | 'ur'; avatarUploadId?: string; removeAvatar?: boolean }): Promise<IUser> {
  return request<IUser>('/users/me', { method: 'PATCH', body: JSON.stringify(data) });
}

export interface Address {
  id: string; label: string | null; streetAddress: string; city: string; area: string | null;
  landmark: string | null; buildingDetail: string | null; country: string; latitude: number | null;
  longitude: number | null; isDefault: boolean;
}
export type AddressInput = Partial<Omit<Address, 'id'>> & { streetAddress: string; city: string; country: string };

export const getAddresses = () => request<Address[]>('/addresses');
export const createAddress = (a: AddressInput) => request<Address>('/addresses', { method: 'POST', body: JSON.stringify(a) });
export const updateAddress = (id: string, a: Partial<AddressInput>) => request<Address>(`/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(a) });
export const deleteAddress = (id: string) => request<{ success: boolean }>(`/addresses/${id}`, { method: 'DELETE' });

export interface DeviceSession { id: string; deviceName: string | null; platform: string | null; lastUsedAt: string; current: boolean }
export const getSessions = () => request<DeviceSession[]>('/auth/sessions');
export const revokeSession = (id: string) => request<{ success: boolean }>(`/auth/sessions/${id}`, { method: 'DELETE' });

// ── Catalog ──────────────────────────────────────────────────

export interface CatalogIssue { id: string; code: string; name: string; translations?: Record<string, { name?: string }> | null }
export interface CatalogService { id: string; name: string; translations?: Record<string, { name?: string }> | null }
export interface CatalogCategory {
  id: string; name: string; description: string | null; iconName: string | null;
  translations?: Record<string, { name?: string }> | null;
  services: CatalogService[]; issues: CatalogIssue[];
}
export const getCatalog = () => request<CatalogCategory[]>('/service-catalog/categories');

// ── Worker profile ───────────────────────────────────────────

export type VerificationType = 'ID' | 'SELFIE' | 'TRADE_LICENSE' | 'INSURANCE';
export type OnboardingStep = 'skills' | 'area' | 'hours' | 'pricing' | 'documents';
export interface WorkerMe {
  id: string; rating: number; isVerified: boolean; bio: string | null; experienceYears: number; languages: string[];
  gender: 'FEMALE' | 'MALE' | null; hidePhotoUntilBooked: boolean; isOnline: boolean;
  equipment: string[];
  serviceLat: number | null; serviceLng: number | null; serviceAreaLabel: string | null; serviceRadius: number;
  pricingModel: 'FIXED' | 'HOURLY' | 'CALLOUT_PLUS_QUOTE' | 'QUOTE' | null;
  minimumCallOutFee: number | null; hourlyRate: number | null; currency: string;
  activationStatus: 'ONBOARDING' | 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'INACTIVE';
  user: { id: string; name: string; phone: string | null; profileImageUrl: string | null };
  services: { category: { id: string; name: string; translations?: Record<string, { name?: string }> | null } }[];
  workingHours: { weekday: number; startMinute: number; endMinute: number }[];
  portfolio: { id: string; title: string; description: string | null; photos: string[] }[];
  businessName?: string | null; teamSize?: number | null;
  verifications: { id: string; type: VerificationType; status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'NEEDS_INFO'; reason: string | null }[];
  onboarding: { steps: Record<OnboardingStep, boolean>; missing: OnboardingStep[]; complete: boolean; percent: number };
}
export type WorkerPatch = Partial<Pick<WorkerMe, 'bio' | 'experienceYears' | 'languages' | 'gender' | 'hidePhotoUntilBooked' | 'pricingModel' | 'minimumCallOutFee' | 'hourlyRate' | 'serviceLat' | 'serviceLng' | 'serviceAreaLabel' | 'serviceRadius' | 'isOnline' | 'teamSize' | 'equipment'>> & { businessName?: string };

export const getWorkerMe = () => request<WorkerMe>('/workers/me');
export const patchWorkerMe = (p: WorkerPatch) => request<WorkerMe>('/workers/me', { method: 'PATCH', body: JSON.stringify(p) });
export const setWorkerSkills = (categoryIds: string[]) => request<WorkerMe>('/workers/me/skills', { method: 'PUT', body: JSON.stringify({ categoryIds }) });
export const setWorkerHours = (days: { weekday: number; startMinute: number; endMinute: number }[]) => request<WorkerMe>('/workers/me/hours', { method: 'PUT', body: JSON.stringify({ days }) });
export const addPortfolioItem = (title: string, uploadIds: string[], description?: string) => request<WorkerMe>('/workers/me/portfolio', { method: 'POST', body: JSON.stringify({ title, uploadIds, description }) });
export const removePortfolioItem = (id: string) => request<WorkerMe>(`/workers/me/portfolio/${id}`, { method: 'DELETE' });
export const submitWorkerDocument = (type: VerificationType, uploadIds: string[], reference?: string) => request<WorkerMe>('/workers/me/verification', { method: 'POST', body: JSON.stringify({ type, uploadIds, reference }) });
export const submitWorkerForReview = () =>
  tracked(request<WorkerMe>('/workers/me/submit', { method: 'POST' }), 'verification_completed');

export interface PublicWorker {
  id: string; rating: number; ratingCount: number; jobsCompleted: number; bio: string | null; experienceYears: number;
  languages: string[]; isVerified: boolean; isOnline: boolean; serviceAreaLabel: string | null; currency: string;
  equipment: string[];
  pricingModel: WorkerMe['pricingModel']; minimumCallOutFee: number | null; hourlyRate: number | null;
  user: { id: string; name: string; profileImageUrl: string | null };
  services: WorkerMe['services'];
  portfolio: WorkerMe['portfolio'];
  badges: { type: VerificationType; verifiedAt: string | null; expiresAt: string | null }[];
}
export const getPublicWorker = (id: string) => request<PublicWorker>(`/workers/${id}`);

// ── notifications ───────────────────────────────────────────
export interface AppNotification {
  id: string; type: string; title: string; body: string;
  data: { url?: string; jobId?: string; [k: string]: unknown } | null;
  readAt: string | null; createdAt: string;
}
export const listNotifications = (cursor?: string) =>
  request<{ items: AppNotification[]; nextCursor: string | null }>(`/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const getUnreadCount = () => request<{ count: number }>('/notifications/unread-count');
export const markNotificationsRead = (ids?: string[]) =>
  request<{ updated: number }>('/notifications/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) });
export const registerPushToken = (token: string) =>
  request<{ success: boolean }>('/notifications/push-token', { method: 'PUT', body: JSON.stringify({ token }) });

// ── Safety ──────────────────────────────────────────────────
export type SosKind = 'LIFE_THREATENING' | 'WATER' | 'ELECTRIC' | 'GAS' | 'IN_JOB';
export interface SosResult {
  incidentId: string; kind: SosKind; jobRequestId: string | null;
  emergencyNumbers: { label: string; number: string }[];
  contacts: { status: 'SENT' | 'PARTLY_SENT' | 'NO_CONTACTS' | 'NO_PROVIDER' | 'FAILED'; alerted: number; message: string } | null;
}
export const getEmergencyNumbers = () => request<{ countryCode: string; numbers: { label: string; number: string }[] }>('/safety/emergency-numbers');
export const raiseSos = (data: { kind: SosKind; idempotencyKey: string; addressId?: string; jobRequestId?: string; note?: string }) =>
  request<SosResult>('/safety/sos', { method: 'POST', body: JSON.stringify(data) });
export interface TrustedContact { id: string; name: string; phone: string; notifyOnSos: boolean }
export const getTrustedContacts = () => request<TrustedContact[]>('/safety/trusted-contacts');
export const addTrustedContact = (name: string, phone: string) => request<TrustedContact>('/safety/trusted-contacts', { method: 'POST', body: JSON.stringify({ name, phone }) });
export const removeTrustedContact = (id: string) => request<{ success: boolean }>(`/safety/trusted-contacts/${id}`, { method: 'DELETE' });

// ── Safety & SOS ─────────────────────────────────────────────

export interface EmergencyNumber { label: string; number: string }
export interface EmergencyNumbers { country: string; numbers: EmergencyNumber[]; disclaimer: string }
export interface IncidentInput {
  type: 'SOS' | 'EMERGENCY' | 'REPORT_PROBLEM';
  severity: 'LIFE_THREATENING' | 'PROPERTY_DAMAGE' | 'MODERATE';
  description?: string; latitude?: number; longitude?: number;
  sosKind?: SosKind; addressId?: string; idempotencyKey?: string;
}
export interface IncidentResult {
  jobId: string | null; replay: boolean; country: string; disclaimer: string;
  emergencyNumbers: EmergencyNumber[];
  trustedContacts: { total: number; notified: number; smsConfigured: boolean };
}
export const reportIncident = (data: IncidentInput) =>
  tracked(request<IncidentResult>('/safety/incidents', { method: 'POST', body: JSON.stringify(data) }), 'incident_created', { type: data.type, severity: data.severity });

// ── Reports (disputes) & saved workers ───────────────────────

export const DISPUTE_CATEGORIES = [
  { id: 'QUALITY', label: 'Work was not good' },
  { id: 'NO_SHOW', label: 'Did not show up' },
  { id: 'PRICE', label: 'Price problem' },
  { id: 'DAMAGE', label: 'Something was damaged' },
  { id: 'BEHAVIOUR', label: 'Rude or unsafe behaviour' },
  { id: 'OTHER', label: 'Something else' },
] as const;
export interface DisputeItem {
  id: string; jobRequestId: string; category: string; reason: string; description: string | null;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED'; resolution: string | null; createdAt: string;
}
export const createDispute = (data: { jobRequestId: string; category: DisputeCategory; reason: string; description?: string }) =>
  request<DisputeItem>('/disputes', { method: 'POST', body: JSON.stringify(data) });
export const getMyDisputes = () => request<DisputeItem[]>('/disputes/my-disputes');

// ── Outbox delivery ──────────────────────────────────────────

/** Sends one queued request and says what to do next. 'sent' also covers "the server already has it" (409). */
export async function sendQueued(item: { method: string; endpoint: string; body?: unknown }): Promise<'sent' | 'retry' | 'rejected'> {
  try {
    await request(item.endpoint, { method: item.method, body: item.body === undefined ? undefined : JSON.stringify(item.body) });
    return 'sent';
  } catch (e) {
    if (!(e instanceof ApiError)) return 'retry';
    if (e.status === 409) return 'sent';
    if (e.status === 0 || e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500) return 'retry';
    return 'rejected';
  }
}

/** True when a failed call means "no connection", i.e. the action can be queued and sent later. */
export const isOfflineError = (e: unknown) => e instanceof ApiError && e.code === 'OFFLINE';

// ── Projects (larger work) ───────────────────────────────────

export type ProjectStatus = 'DRAFT' | 'OPEN' | 'AWARDED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type StageStatus = 'PENDING' | 'FUNDED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' | 'RELEASED' | 'DISPUTED' | 'CANCELLED';
export type WorkType = 'NEW_BUILD' | 'RENOVATION' | 'INSTALLATION' | 'MAINTENANCE';
export type PropertyType = 'HOUSE' | 'APARTMENT' | 'SHOP' | 'OFFICE' | 'OTHER';
export type StartWhen = 'ASAP' | 'THIS_MONTH' | 'LATER';
export type PaymentMode = 'ESCROW' | 'DIRECT';

export interface CreateProjectInput {
  categoryId: string; title: string; description?: string; workType: WorkType; propertyType?: PropertyType; addressId: string;
  budgetMin?: number; budgetMax?: number; startWhen?: StartWhen; photoUploadIds?: string[]; audioUploadId?: string; audioTranscript?: string;
  suggestedMilestones?: { title: string; percent: number }[]; idempotencyKey: string;
}
export interface StagePayment { id: string; method: 'CARD' | 'DIRECT'; status: string; amount: number; checkoutUrl: string | null; paidAt: string | null; releasedAt: string | null }
export interface ProjectStage {
  id: string; position: number; title: string; amount: number; status: StageStatus; submittedNote: string | null; changesNote: string | null;
  submittedAt: string | null; evidence: string[]; payments: StagePayment[];
}
export interface ProjectMaterial { id: string; name: string; quantity: number; unit: string | null; providedBy: 'customer' | 'worker'; isReady: boolean; addedById: string }
export interface ProjectVisit { id: string; scheduledAt: string; note: string | null; status: 'PLANNED' | 'DONE' | 'CANCELLED' }
export interface ProjectBidMine { id: string; totalAmount: number; durationDays: number; note: string | null; milestones: { title: string; amount: number }[]; status: MyOffer['status'] }
export interface ProjectView {
  id: string; viewer: 'customer' | 'hired' | 'candidate'; title: string; description: string; status: ProjectStatus; workType: WorkType; propertyType: PropertyType;
  paymentMode: PaymentMode; cardAvailable: boolean; currency: string; budgetMin: number | null; budgetMax: number | null; startWhen: StartWhen; agreedAmount: number | null;
  area: string | null; city: string | null; location: string | null; distanceKm: number | null; createdAt: string;
  category: NonNullable<JobView['category']>; customer: { id?: string; name: string };
  awardedWorker: { id: string; rating: number; isVerified: boolean; businessName: string | null; user: { name: string; profileImageUrl: string | null } } | null;
  suggestedMilestones: { title: string; percent: number }[] | null; photos: string[]; audioUrl: string | null; audioTranscript: string | null;
  milestones: ProjectStage[]; materials: ProjectMaterial[]; visits: ProjectVisit[]; reviews: { id: string; reviewerId: string; rating: number }[];
  bidCount?: number; myBid: ProjectBidMine | null;
}
export interface ProjectListItem {
  id: string; title: string; status: ProjectStatus; workType: WorkType; area: string | null; city: string | null; currency: string; agreedAmount: number | null;
  budgetMin: number | null; budgetMax: number | null; createdAt: string; category: NonNullable<JobView['category']>; bidCount?: number;
  stages: { total: number; done: number }; currentStage: { title: string; status: StageStatus } | null;
}
export interface ProjectFeedItem {
  id: string; title: string; description: string; workType: WorkType; propertyType: PropertyType; area: string | null; city: string | null; distanceKm: number | null;
  budgetMin: number | null; budgetMax: number | null; currency: string; startWhen: StartWhen; createdAt: string; category: NonNullable<JobView['category']>;
  myBid: { id: string; totalAmount: number; status: MyOffer['status'] } | null;
}
export interface ProjectBidCard {
  id: string; totalAmount: number; currency: string; durationDays: number; note: string | null; status: MyOffer['status'];
  milestones: { title: string; amount: number }[];
  worker: { id: string; name: string; businessName: string | null; teamSize: number | null; profileImageUrl: string | null; rating: number; ratingCount: number; jobsCompleted: number; isVerified: boolean; experienceYears: number; distanceKm: number | null };
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const createProject = (input: CreateProjectInput) => post<ProjectView>('/projects', input);
export const listProjects = (cursor?: string) => request<Page<ProjectListItem>>(`/projects${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const getProjectFeed = () => request<ProjectFeedItem[]>('/workers/me/projects');
export const getProject = (id: string) => request<ProjectView>(`/projects/${id}`);
export const cancelProject = (id: string, reason?: string) => post<{ success: boolean }>(`/projects/${id}/cancel`, { reason });
export const listProjectBids = (id: string) => request<ProjectBidCard[]>(`/projects/${id}/bids`);
export const sendProjectBid = (id: string, bid: { totalAmount: number; durationDays: number; note?: string; milestones?: { title: string; amount: number }[] }) =>
  request<ProjectBidMine>(`/projects/${id}/bids/mine`, { method: 'PUT', body: JSON.stringify(bid) });
export const withdrawProjectBid = (id: string) => request<{ success: boolean }>(`/projects/${id}/bids/mine`, { method: 'DELETE' });
export const declineProject = (id: string) => post<{ success: boolean }>(`/projects/${id}/not-interested`);
export const awardProject = (id: string, bidId: string, paymentMode: PaymentMode) => post<ProjectView>(`/projects/${id}/award`, { bidId, paymentMode });

export const fundStage = (id: string) => post<{ checkoutUrl: string }>(`/project-stages/${id}/fund`);
export const startStage = (id: string) => post<unknown>(`/project-stages/${id}/start`);
export const submitStage = (id: string, data: { note?: string; photoUploadIds?: string[] }) => post<unknown>(`/project-stages/${id}/submit`, data);
export const requestStageChanges = (id: string, note: string) => post<unknown>(`/project-stages/${id}/request-changes`, { note });
export const approveStage = (id: string) => post<unknown>(`/project-stages/${id}/approve`);
export const markStagePaid = (id: string) => post<unknown>(`/project-stages/${id}/mark-paid`);
export const disputeStage = (id: string, reason: string) => post<unknown>(`/project-stages/${id}/dispute`, { reason });

export const addMaterial = (id: string, data: { name: string; quantity: number; unit?: string; providedBy: 'customer' | 'worker' }) => post<ProjectMaterial>(`/projects/${id}/materials`, data);
export const setMaterialReady = (id: string, materialId: string, isReady: boolean) => request<unknown>(`/projects/${id}/materials/${materialId}`, { method: 'PATCH', body: JSON.stringify({ isReady }) });
export const removeMaterial = (id: string, materialId: string) => request<unknown>(`/projects/${id}/materials/${materialId}`, { method: 'DELETE' });
export const addVisit = (id: string, scheduledAt: string, note?: string) => post<ProjectVisit>(`/projects/${id}/visits`, { scheduledAt, note });
export const updateVisit = (id: string, visitId: string, status: 'DONE' | 'CANCELLED') => request<unknown>(`/projects/${id}/visits/${visitId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const conversationForProject = (id: string) => request<{ id: string }>(`/conversations/by-project/${id}`);

export interface ProjectScope { title: string; stages: { title: string; percent: number }[]; questions: string[] }
export const suggestProjectScope = (data: { categoryId: string; workType: WorkType; description?: string; photoUploadIds?: string[]; locale?: 'en' | 'ur' | 'ar' }) =>
  post<{ available: boolean; suggestion: ProjectScope | null }>('/ai/project-scope', data);
/** Off on the server unless enabled; the app then just asks the person to type the number. */
export const readIdNumber = (uploadId: string) => post<{ available: boolean; idNumber: string | null }>('/ai/id-ocr', { uploadId });
