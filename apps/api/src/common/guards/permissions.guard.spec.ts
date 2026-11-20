import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSION_KEY } from '../auth/permissions';
import { ROLES_KEY } from '../decorators/roles.decorator';

describe('PermissionsGuard', () => {
  const prisma: any = { user: { findUnique: jest.fn() } };
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector, prisma);
  const meta = (permission?: string, roles?: string[]) => (reflector.getAllAndOverride as jest.Mock).mockImplementation((k: string) => (k === PERMISSION_KEY ? permission : k === ROLES_KEY ? roles : undefined));
  const ctx = (user?: any) => {
    const req: any = { user };
    return { req, c: { getHandler: () => 0, getClass: () => 1, switchToHttp: () => ({ getRequest: () => req }) } as any };
  };
  beforeEach(() => jest.resetAllMocks());

  it('routes with no staff requirement are open to the other guards', async () => {
    meta(undefined, ['customer']);
    expect(await guard.canActivate(ctx().c)).toBe(true);
    meta(undefined, undefined);
    expect(await guard.canActivate(ctx().c)).toBe(true);
  });

  it('an admin-only route with no declared permission fails closed', async () => {
    meta(undefined, ['admin']);
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }).c)).rejects.toMatchObject({ response: { code: 'NO_PERMISSION_DECLARED' } });
  });

  it('non-staff and anonymous callers are refused', async () => {
    meta('users.read', ['admin']);
    await expect(guard.canActivate(ctx({ id: 'u', type: 'customer' }).c)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx(undefined).c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('roles are read fresh: a removed role is refused at once, with the permission named', async () => {
    meta('finance.settle', ['admin']);
    prisma.user.findUnique.mockResolvedValue({ adminRoles: ['Support'] });
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }).c)).rejects.toMatchObject({ response: { code: 'MISSING_PERMISSION', details: { permission: 'finance.settle' } } });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }).c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a staff member holding the permission passes and the request carries their roles', async () => {
    meta('finance.settle', ['admin']);
    prisma.user.findUnique.mockResolvedValue({ adminRoles: ['Finance'] });
    const { c, req } = ctx({ id: 'a', type: 'admin' });
    expect(await guard.canActivate(c)).toBe(true);
    expect(req.adminRoles).toEqual(['Finance']);
  });
});
