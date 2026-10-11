// Admin API client: real endpoints only. No tokens baked in, no fallback data.

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');
if (!BASE) throw new Error('VITE_API_URL is not set. Copy apps/admin/.env.example to .env.');

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const REFRESH_KEY = 'fixli_admin_refresh';
const DEVICE_KEY = 'fixli_admin_device';
let accessToken: string | null = null; // memory only
let onExpired: (() => void) | null = null;

export const setExpiredHandler = (fn: (() => void) | null) => { onExpired = fn; };

function deviceId(): string {
  let id = sessionStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    sessionStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function hasStoredSession(): boolean {
  return !!sessionStorage.getItem(REFRESH_KEY);
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  return new ApiError(body?.error?.message ?? 'Something went wrong', res.status, body?.error?.code, body?.error?.details);
}

function save(tokens: { token: string; refreshToken: string }) {
  accessToken = tokens.token;
  sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearSession() {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_KEY);
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = sessionStorage.getItem(REFRESH_KEY);
      if (!refreshToken) return false;
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
      if (!res.ok) { clearSession(); return false; }
      save(await res.json());
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = () => fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init.headers },
  });
  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refresh()) res = await send();
    else onExpired?.();
  }
  if (!res.ok) throw await toError(res);
  return res.json();
}

export interface AdminUser { id: string; name: string; email: string | null; type: string }

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await toError(res);
  return res.json();
}
const device = () => ({ deviceId: deviceId(), deviceName: 'Admin web', platform: 'web' });

/**
 * Staff sign-in: password, then the authenticator code. Throws ApiError with code
 * TOTP_REQUIRED (ask for the code), INVALID_CODE, or TOTP_SETUP_REQUIRED (details.setupToken: enrol).
 */
export async function login(email: string, password: string, code?: string): Promise<AdminUser> {
  const body = await post<{ user: AdminUser; token: string; refreshToken: string }>('/auth/admin/login', { email, password, ...(code ? { code } : {}), ...device() });
  save(body);
  return body.user;
}

export const beginTotpSetup = (setupToken: string) => post<{ secret: string; otpauthUrl: string }>('/auth/admin/totp/setup', { setupToken });

export async function activateTotp(setupToken: string, code: string): Promise<{ user: AdminUser; recoveryCodes: string[] }> {
  const body = await post<{ user: AdminUser; token: string; refreshToken: string; recoveryCodes: string[] }>('/auth/admin/totp/activate', { setupToken, code, ...device() });
  save(body);
  return { user: body.user, recoveryCodes: body.recoveryCodes };
}

export async function restore(): Promise<AdminUser | null> {
  if (!hasStoredSession()) return null;
  if (!accessToken && !(await refresh())) return null;
  try {
    const me = await request<AdminUser>('/auth/me');
    return me.type === 'admin' ? me : null;
  } catch { return null; }
}

export async function logout() {
  try { await request('/auth/logout', { method: 'POST' }); } catch { /* already gone */ }
  clearSession();
}

// ── Domain calls ─────────────────────────────────────────────

export interface Stats { users: Record<string, number>; workers: Record<string, number>; jobs: Record<string, number>; openDisputes: number; pendingVerifications: number }
export const getStats = () => request<Stats>('/admin/v1/stats');

export interface CaseRow { id: string; type: string; status: string; createdAt: string; reference: string | null; worker: { id: string; activationStatus: string; user: { name: string; phone: string | null } } }
export const listCases = (status = 'SUBMITTED') => request<{ items: CaseRow[]; nextCursor: string | null }>(`/admin/v1/verification-cases?status=${status}`);
export interface CaseDetail extends CaseRow { documents: { url: string }[]; worker: CaseRow['worker'] & { verifications: { id: string; type: string; status: string; reason: string | null }[] } }
export const getCase = (id: string) => request<CaseDetail>(`/admin/v1/verification-cases/${id}`);
export const decideCase = (id: string, decision: 'APPROVE' | 'REJECT' | 'NEEDS_INFO', reason?: string) =>
  request<{ id: string; status: string }>(`/admin/v1/verification-cases/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) });

export interface DisputeRow { id: string; reason: string; description: string | null; status: string; resolution: string | null; createdAt: string; raisedBy: { name: string; type: string }; jobRequest: { id: string; customerName: string; status: string } }
export const listDisputes = () => request<DisputeRow[]>('/disputes/all');
export const updateDispute = (id: string, status: string, resolution?: string) =>
  request(`/disputes/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ status, resolution }) });

export interface Category { id: string; name: string; description: string | null; iconName: string | null; isActive: boolean; translations: Record<string, { name?: string }> | null; services: { id: string; name: string }[]; issues: { id: string; name: string }[] }
export const listCategories = () => request<Category[]>('/service-catalog/categories');

// ── Users ──────────────────────────────────────────────────
export interface SearchUserRow { id: string; name: string; phone: string | null; email: string | null; type: string; status: string; createdAt: string; worker?: { activationStatus: string } }
export const searchUsers = (q: string) => request<SearchUserRow[]>(`/admin/v1/users?q=${encodeURIComponent(q)}`);
export const suspendUser = (id: string, reason: string) => request<{ success: boolean }>(`/admin/v1/users/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });

// ── Jobs ───────────────────────────────────────────────────
export interface AdminJobRow { id: string; status: string; createdAt: string; customerId: string; assignedWorkerId: string | null; category: { name: string } | null; customer: { name: string } | null; assignedWorker: { user: { name: string } } | null }
export const listJobs = (status?: string, skip: number = 0) => request<AdminJobRow[]>(`/admin/v1/jobs?skip=${skip}${status ? `&status=${status}` : ''}`);
export const adminCancelJob = (id: string, reason: string) => request<{ success: boolean }>(`/admin/v1/jobs/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });

// ── Ledger ─────────────────────────────────────────────────
export interface LedgerRow { id: string; method: string; amount: number; currency: string; status: string; createdAt: string; jobRequest?: { id: string } }
export const listPayments = (skip: number = 0) => request<LedgerRow[]>(`/admin/v1/payments?skip=${skip}`);
