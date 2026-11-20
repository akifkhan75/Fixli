import { ADMIN_ROLES, ALL_PERMISSIONS, hasPermission, permissionsFor } from './permissions';

describe('staff permissions', () => {
  it('Super Admin has everything; no role has a permission missing from the full list', () => {
    expect(permissionsFor(['Super Admin']).sort()).toEqual([...ALL_PERMISSIONS].sort());
    for (const r of ADMIN_ROLES) for (const p of permissionsFor([r])) expect(ALL_PERMISSIONS).toContain(p);
  });
  it('key separations hold', () => {
    expect(hasPermission(['Finance'], 'documents.view')).toBe(false);
    expect(hasPermission(['Verification'], 'finance.read')).toBe(false);
    expect(hasPermission(['Analytics'], 'pii.view')).toBe(false);
    expect(hasPermission(['Operations'], 'config.edit')).toBe(false); // country money rules: Super Admin only
    expect(hasPermission(['Support'], 'jobs.manage')).toBe(true);
    expect(hasPermission(['Safety'], 'safety.manage')).toBe(true);
    expect(hasPermission([], 'dashboard.view')).toBe(false);
  });
});
