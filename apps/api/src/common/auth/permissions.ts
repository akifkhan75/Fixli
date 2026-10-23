import { SetMetadata } from '@nestjs/common';

/**
 * Staff permissions (doc 12 roles -> what each may do). Routes declare one permission; roles are
 * only ever checked through this map, so "who can do what" lives in one reviewed place.
 */
export const ADMIN_ROLES = [
  'Super Admin', 'Operations', 'Verification', 'Support', 'Safety', 'Finance', 'Content', 'Analytics', 'Auditor',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type Permission =
  | 'dashboard.view'
  | 'verification.read'
  | 'verification.decide'
  /** Signed links to ID documents and selfies. */
  | 'documents.view'
  | 'users.read'
  | 'users.suspend'
  /** Full phone numbers / emails of customers and workers (masked otherwise). */
  | 'pii.view'
  | 'jobs.read'
  | 'jobs.cancel'
  /** Take a job back from a worker who didn't come, and find someone else. */
  | 'jobs.manage'
  /** Read a job's chat (audited). */
  | 'chat.read'
  | 'safety.read'
  /** Change an incident's status, add notes. */
  | 'safety.manage'
  | 'disputes.read'
  | 'disputes.resolve'
  | 'finance.read'
  /** Confirm or reject a worker's reported settlement (changes the ledger). */
  | 'finance.settle'
  /** Manual ledger corrections when resolving a dispute. */
  | 'finance.adjust'
  | 'catalog.read'
  | 'catalog.edit'
  | 'config.read'
  /** Country settings and feature flags (versioned, audited). */
  | 'config.edit'
  | 'reviews.moderate'
  | 'recurring.manage'
  | 'audit.read'
  | 'staff.manage';

export const ALL_PERMISSIONS: Permission[] = [
  'dashboard.view', 'verification.read', 'verification.decide', 'documents.view', 'users.read', 'users.suspend', 'pii.view',
  'jobs.read', 'jobs.cancel', 'jobs.manage', 'chat.read', 'safety.read', 'safety.manage', 'disputes.read', 'disputes.resolve',
  'finance.read', 'finance.settle', 'finance.adjust', 'catalog.read', 'catalog.edit', 'config.read', 'config.edit',
  'reviews.moderate', 'recurring.manage', 'audit.read', 'staff.manage',
];

const ROLE_PERMISSIONS: Record<Exclude<AdminRole, 'Super Admin'>, Permission[]> = {
  Operations: ['dashboard.view', 'verification.read', 'users.read', 'users.suspend', 'pii.view', 'jobs.read', 'jobs.cancel', 'jobs.manage', 'chat.read', 'safety.read', 'safety.manage', 'disputes.read', 'disputes.resolve', 'catalog.read', 'config.read', 'reviews.moderate', 'recurring.manage'],
  Verification: ['dashboard.view', 'verification.read', 'verification.decide', 'documents.view'],
  Support: ['dashboard.view', 'users.read', 'pii.view', 'jobs.read', 'jobs.cancel', 'jobs.manage', 'chat.read', 'disputes.read'],
  Safety: ['dashboard.view', 'safety.read', 'safety.manage', 'chat.read', 'users.read', 'users.suspend', 'pii.view', 'jobs.read', 'reviews.moderate'],
  Finance: ['dashboard.view', 'finance.read', 'finance.settle', 'finance.adjust', 'disputes.read', 'disputes.resolve', 'chat.read', 'config.read'],
  Content: ['dashboard.view', 'catalog.read', 'catalog.edit', 'reviews.moderate', 'config.read'],
  Analytics: ['dashboard.view', 'jobs.read'],
  Auditor: ['dashboard.view', 'audit.read'],
};

/** Everything a set of roles may do (for the portal's menu). */
export function permissionsFor(roles: readonly string[] | null | undefined): Permission[] {
  if (!roles?.length) return [];
  if (roles.includes('Super Admin')) return ALL_PERMISSIONS;
  return [...new Set(roles.flatMap((r) => (isAdminRole(r) && r !== 'Super Admin' ? ROLE_PERMISSIONS[r] : [])))];
}

export function isAdminRole(r: string): r is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(r);
}

export function hasPermission(roles: readonly string[] | null | undefined, p: Permission): boolean {
  if (!roles?.length) return false;
  if (roles.includes('Super Admin')) return true;
  return roles.some((r) => isAdminRole(r) && r !== 'Super Admin' && ROLE_PERMISSIONS[r].includes(p));
}

/** Socket rooms a staff member joins: one per permission that has a live feed. */
export const FEED_PERMISSIONS = ['verification.read', 'disputes.read', 'safety.read', 'finance.read'] as const satisfies readonly Permission[];

export const PERMISSION_KEY = 'adminPermission';
/** The one permission this admin route needs. Admin-only routes without it are refused. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);
