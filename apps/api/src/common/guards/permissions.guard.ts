import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Role } from '../decorators/roles.decorator';
import { hasPermission, Permission, PERMISSION_KEY } from '../auth/permissions';
import { PrismaService } from '../../database/prisma.service';

/**
 * Staff authorisation, deny by default:
 *  - a route that declares a permission needs an admin holding it (roles read fresh from the DB,
 *    so removing a role takes effect on the next request);
 *  - a route open only to admins that declares no permission is refused, so a forgotten
 *    decorator fails closed instead of exposing data to every staff role.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const adminOnly = !!roles?.length && roles.every((r) => r === 'admin');
    if (!permission && !adminOnly) return true;
    if (!permission) throw new ForbiddenException({ code: 'NO_PERMISSION_DECLARED', message: 'This action is not available.' });

    const user = context.switchToHttp().getRequest().user as { id: string; type: string } | undefined;
    if (!user || user.type !== 'admin') throw new ForbiddenException('You do not have permission to do this');
    const staff = await this.prisma.user.findUnique({ where: { id: user.id }, select: { adminRoles: true } });
    if (!hasPermission(staff?.adminRoles, permission)) {
      throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Your staff role does not allow this.', details: { permission } });
    }
    (context.switchToHttp().getRequest() as any).adminRoles = staff!.adminRoles;
    return true;
  }
}
