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
export const suspendUser = (id: string, reason: string) => request<{ status: string; cancelled: string[]; offersWithdrawn: number; activeBookings: { id: string; status: string; title: string | null }[] }>(`/admin/v1/users/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) });

// ── Jobs ───────────────────────────────────────────────────
export interface AdminJobRow { id: string; status: string; createdAt: string; customerId: string; assignedWorkerId: string | null; category: { name: string } | null; customer: { name: string } | null; assignedWorker: { user: { name: string } } | null }
export const listJobs = (status?: string, skip: number = 0) => request<AdminJobRow[]>(`/admin/v1/jobs?skip=${skip}${status ? `&status=${status}` : ''}`);
export const adminCancelJob = (id: string, reason: string) => request<{ success: boolean }>(`/admin/v1/jobs/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });

// ── Ledger ─────────────────────────────────────────────────
export interface LedgerRow { id: string; method: string; amount: number; currency: string; status: string; createdAt: string; jobRequest?: { id: string } }
export const listPayments = (skip: number = 0) => request<LedgerRow[]>(`/admin/v1/payments?skip=${skip}`);

/** For the live feed: the current access token, refreshed first if needed. */
export async function liveToken(): Promise<string | null> {
  if (!accessToken && !(await refresh())) return null;
  return accessToken;
}
export const API_BASE = BASE;

// ── Staff console (doc 27 F6) ───────────────────────────────
export interface Me { id: string; name: string; email: string | null; adminRoles: string[]; permissions: string[]; totpEnabledAt: string | null }
export const getMe = () => request<Me>('/admin/v1/me');
export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ success: boolean }>('/auth/password/change', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });

export interface Dashboard {
  range: { from: string; to: string }; users: Record<string, number>; workersOnline: number; jobsNow: Record<string, number>;
  requests: number; booked: number; fillRate: number | null; medianMinutesToFirstOffer: number | null;
  cancellations: Record<string, number>; openDisputes: number; openIncidents: number;
  gmv: { currency: string; amount: number; payments: number }[]; commissionOwed: { amount: number; workers: number }; commissionSettled: number;
}
export const getDashboard = (from?: string, to?: string) => request<Dashboard>(`/admin/v1/dashboard?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`);

export interface Paged<T> { items: T[]; nextCursor: string | null }
const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); return p.toString(); };

export const getJobDetail = (id: string) => request<any>(`/admin/v1/jobs/${id}`);
export const getTranscript = (id: string) => request<{ participants: { id: string; name: string; type: string }[]; messages: { id: string; senderId: string | null; text: string | null; imageUrl: string | null; isSystem: boolean; isFlagged: boolean; createdAt: string }[] }>(`/admin/v1/jobs/${id}/transcript`);
export const reassignJob = (id: string, reason: string) => request(`/admin/v1/jobs/${id}/reassign`, { method: 'POST', body: JSON.stringify({ reason }) });
export const reactivateUser = (id: string, reason: string) => request(`/admin/v1/users/${id}/reactivate`, { method: 'POST', body: JSON.stringify({ reason }) });

export interface StaffRow { id: string; name: string; email: string | null; status: string; adminRoles: string[]; totpEnabledAt: string | null; lastLoginAt: string | null }
export const listStaff = () => request<StaffRow[]>('/admin/v1/staff');
export const createStaff = (email: string, name: string, roles: string[]) => request<{ id: string; temporaryPassword: string }>('/admin/v1/staff', { method: 'POST', body: JSON.stringify({ email, name, roles }) });
export const setStaffRoles = (id: string, roles: string[]) => request(`/admin/v1/staff/${id}/roles`, { method: 'PATCH', body: JSON.stringify({ roles }) });
export const resetStaff2fa = (id: string, reason: string) => request(`/admin/v1/staff/${id}/reset-2fa`, { method: 'POST', body: JSON.stringify({ reason }) });

export interface AuditRow { id: string; actorId: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown; createdAt: string }
export const getAudit = (f: { actorId?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string; cursor?: string }) => request<Paged<AuditRow>>(`/admin/v1/audit?${qs(f)}`);

export interface IncidentRow { id: string; type: string; kind: string | null; severity: string; status: string; description: string | null; createdAt: string; contactsAlertStatus: string | null; reporter: { id: string; name: string; type: string }; jobRequest: { id: string; title: string | null; status: string } | null }
export const listIncidents = (f: { status?: string; type?: string; cursor?: string }) => request<Paged<IncidentRow>>(`/admin/v1/safety/incidents?${qs(f)}`);
export const getIncident = (id: string) => request<IncidentRow & { target: { id: string; name: string; type: string; status: string } | null; notes: { id: string; authorId: string; text: string; createdAt: string }[] }>(`/admin/v1/safety/incidents/${id}`);
export const updateIncident = (id: string, body: { status?: string; note?: string }) => request(`/admin/v1/safety/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const listPaymentsFiltered = (f: { status?: string; cursor?: string }) => request<Paged<any>>(`/admin/v1/finance/payments?${qs(f)}`);
export interface BalanceRow { id: string; ledgerBalance: number; owedSince: string | null; balanceBlocked: boolean; currency: string; user: { name: string } }
export const listBalances = () => request<BalanceRow[]>('/admin/v1/finance/balances');
export const workerLedger = (id: string) => request<any[]>(`/admin/v1/finance/workers/${id}/ledger`);
export const adjustLedger = (id: string, amount: number, note: string, idempotencyKey: string) => request(`/admin/v1/finance/workers/${id}/adjustments`, { method: 'POST', body: JSON.stringify({ amount, note, idempotencyKey }) });
export interface SettlementRow { id: string; workerId: string; amount: number; currency: string; rail: string; reference: string; status: string; createdAt: string; worker: { ledgerBalance: number; user: { name: string } } }
export const listSettlements = (status = 'PENDING') => request<SettlementRow[]>(`/admin/v1/settlements?status=${status}`);
export const decideSettlement = (id: string, approve: boolean, note?: string) => request(`/admin/v1/settlements/${id}/${approve ? 'confirm' : 'reject'}`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) });

export const getDisputeDetail = (id: string) => request<any>(`/admin/v1/disputes/${id}`);
export const resolveDispute = (id: string, body: { status: string; resolution?: string; paymentOutcome?: 'CONFIRM' | 'VOID'; ledgerAdjustment?: { amount: number; note: string } }) =>
  request(`/disputes/${id}/resolve`, { method: 'PATCH', body: JSON.stringify(body) });

export const reviewQueue = (hidden = false) => request<any[]>(`/admin/v1/moderation/reviews${hidden ? '?hidden=true' : ''}`);
export const moderateReview = (id: string, action: 'HIDE' | 'RESTORE' | 'DISMISS', note?: string) => request(`/admin/v1/moderation/reviews/${id}`, { method: 'POST', body: JSON.stringify({ action, note }) });

export interface AdminIssue { id: string; code: string; name: string; translations: Record<string, { name?: string }> | null; isActive: boolean }
export interface AdminCategory { id: string; name: string; isActive: boolean; sortOrder: number; translations: Record<string, { name?: string }> | null; services: { id: string; name: string; isActive: boolean }[]; issues: AdminIssue[] }
export const adminCatalog = () => request<AdminCategory[]>('/admin/v1/catalog/categories');
export const updateCategoryContent = (id: string, body: { translations?: Record<string, { name?: string }>; isActive?: boolean; sortOrder?: number }) => request(`/admin/v1/catalog/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const saveIssue = (categoryId: string, body: { code: string; name: string; translations?: Record<string, { name?: string }>; isActive?: boolean }) => request(`/admin/v1/catalog/categories/${categoryId}/issues`, { method: 'PUT', body: JSON.stringify(body) });
export interface PriceBand { id: string; categoryId: string; issueCode: string | null; city: string; currency: string; minMinor: number; maxMinor: number; approved: boolean }
export const listPriceBands = () => request<PriceBand[]>('/admin/v1/catalog/price-bands');
export const savePriceBand = (b: Omit<PriceBand, 'id'>) => request<PriceBand>('/admin/v1/catalog/price-bands', { method: 'PUT', body: JSON.stringify(b) });

export interface CountryConfig {
  countryCode: string; currency: string; version: number;
  commission: { rateBps: number; minMinor: number; maxMinor: number };
  cashLimits: { softMinor: number; hardMinor: number; maxDaysOwed: number };
  settlementRails: { id: string; label: string; account: string | null }[];
  emergencyNumbers: { label: string; number: string }[];
  versions: { version: number; editedById: string | null; createdAt: string }[];
}
export const getCountryConfig = (code = 'PK') => request<CountryConfig>(`/admin/v1/config/countries/${code}`);
export const saveCountryConfig = (code: string, c: Pick<CountryConfig, 'commission' | 'cashLimits' | 'settlementRails' | 'emergencyNumbers'> & { baseVersion: number }) =>
  request<CountryConfig>(`/admin/v1/config/countries/${code}`, { method: 'PUT', body: JSON.stringify(c) });
export interface Flag { key: string; description: string; value: unknown; setByStaff: boolean }
export const listFlags = () => request<Flag[]>('/admin/v1/config/flags');
export const setFlag = (key: string, value: boolean) => request(`/admin/v1/config/flags/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });

/** Money: integer minor units (2 decimals for PKR) <-> what staff type. */
export const toMajor = (minor: number) => (minor / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
export const money = (minor: number, currency = 'PKR') => `${currency} ${toMajor(minor)}`;
export const parseMajor = (s: string): number | null => { const v = Number(String(s).replace(/,/g, '')); return Number.isFinite(v) ? Math.round(v * 100) : null; };
