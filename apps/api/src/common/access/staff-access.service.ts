import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { hasPermission, Permission } from '../auth/permissions';

/**
 * For shared routes (job details, dispute details, private file links) that admins can also use:
 * the admin must hold the permission. Customers and workers pass straight through; their own
 * ownership checks apply as before.
 */
@Injectable()
export class StaffAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assert(user: { id: string; type: string }, ...anyOf: Permission[]) {
    if (user.type !== 'admin') return;
    const staff = await this.prisma.user.findUnique({ where: { id: user.id }, select: { adminRoles: true } });
    if (!anyOf.some((p) => hasPermission(staff?.adminRoles, p))) {
      throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Your staff role does not allow this.', details: { permission: anyOf[0] } });
    }
  }
}
