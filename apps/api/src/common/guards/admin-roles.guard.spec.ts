import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRolesGuard } from './admin-roles.guard';

describe('AdminRolesGuard', () => {
  const prisma: any = { user: { findUnique: jest.fn() } };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new AdminRolesGuard(reflector as unknown as Reflector, prisma);
  const ctx = (user: any) => ({ getHandler: () => 0, getClass: () => 0, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

  beforeEach(() => jest.resetAllMocks());

  it('lets a route with no admin roles through', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(true);
    reflector.getAllAndOverride.mockReturnValue([]);
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(true);
  });
  it('refuses anyone who is not an admin account', async () => {
    reflector.getAllAndOverride.mockReturnValue(['Support']);
    await expect(guard.canActivate(ctx({ id: 'u', type: 'customer' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('checks the roles stored now, not the ones in the token', async () => {
    reflector.getAllAndOverride.mockReturnValue(['Support']);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }))).rejects.toBeInstanceOf(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue({ adminRoles: ['Finance'] });
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }))).rejects.toBeInstanceOf(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue({ adminRoles: ['Support'] });
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }))).resolves.toBe(true);
  });
  it('Super Admin passes everything', async () => {
    reflector.getAllAndOverride.mockReturnValue(['Compliance']);
    prisma.user.findUnique.mockResolvedValue({ adminRoles: ['Super Admin'] });
    await expect(guard.canActivate(ctx({ id: 'a', type: 'admin' }))).resolves.toBe(true);
  });
});
