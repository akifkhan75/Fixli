import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AdminRole } from '../common/auth/permissions';

/** "0300 1234567" -> "03•••••567". Staff without pii.view never get full contact details. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\s/g, '');
  return d.length <= 5 ? '•••' : `${d.slice(0, 3)}${'•'.repeat(Math.max(3, d.length - 6))}${d.slice(-3)}`;
}
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}•••@${domain ?? ''}`;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  // Users
  async searchUsers(query: string, fullPii: boolean) {
    if (query.length < 2) return [];
    const digits = query.replace(/\D/g, '');
    const rows = await this.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }] : []),
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, phone: true, email: true, type: true, status: true, createdAt: true, worker: { select: { activationStatus: true } } },
      take: 50,
    });
    return fullPii ? rows : rows.map((u) => ({ ...u, phone: maskPhone(u.phone), email: maskEmail(u.email) }));
  }

  async userDetail(id: string, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, phone: true, email: true, type: true, status: true, countryCode: true, locale: true, createdAt: true, lastLoginAt: true,
        worker: { select: { activationStatus: true, isVerified: true, rating: true } },
        _count: { select: { jobRequests: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.audit.record({ actorId: adminId, action: 'user.contact_viewed', entityType: 'User', entityId: id });
    return user;
  }

  async suspendUser(id: string, adminId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true, type: true } });
    if (!user) throw new NotFoundException('User not found');
    if (id === adminId) throw new BadRequestException({ code: 'CANNOT_SUSPEND_SELF', message: 'You cannot suspend your own account.' });

    await this.prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
    // Out everywhere at once: sessions, live connections and push tokens.
    await this.sessions.revokeAllExcept(id);
    await this.audit.record({
      actorId: adminId, action: 'user.suspended', entityType: 'User', entityId: id,
      before: { status: user.status }, after: { status: 'SUSPENDED', reason },
    });
    return { id, status: 'SUSPENDED' };
  }

  // Jobs
  async getJobsList(status: string | undefined, skip = 0, take = 50, fullPii = false) {
    const rows = await this.prisma.jobRequest.findMany({
      where: status ? { status: status as any } : {},
      include: {
        customer: { select: { name: true, phone: true } },
        assignedWorker: { select: { user: { select: { name: true, phone: true } } } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    if (fullPii) return rows;
    return rows.map((j) => ({
      ...j,
      location: null, latitude: null, longitude: null,
      customer: j.customer ? { ...j.customer, phone: maskPhone(j.customer.phone) } : null,
      assignedWorker: j.assignedWorker ? { user: { ...j.assignedWorker.user, phone: maskPhone(j.assignedWorker.user.phone) } } : null,
    }));
  }

  async cancelJob(id: string, adminId: string, reason: string) {
    // F6 routes this through the job state machine; until then refuse finished jobs and unknown ids.
    const job = await this.prisma.jobRequest.findUnique({ where: { id }, select: { status: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      throw new BadRequestException({ code: 'JOB_CLOSED', message: 'This job is already finished.' });
    }
    const updated = await this.prisma.jobRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: adminId, cancelReason: 'OTHER' } });
    await this.prisma.jobEvent.create({ data: { jobRequestId: id, actorId: adminId, type: 'CANCELLED', fromStatus: job.status, toStatus: 'CANCELLED', payload: { by: 'admin', reason } } });
    await this.audit.record({ actorId: adminId, action: 'job.cancelled', entityType: 'JobRequest', entityId: id, before: { status: job.status }, after: { status: 'CANCELLED', reason } });
    return updated;
  }

  // Audits
  async getAuditLogs(skip = 0, take = 100) {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip, take });
  }

  // Safety Incidents
  async getIncidents(status?: string, skip = 0, take = 50) {
    return this.prisma.incident.findMany({
      where: status ? { status } : {},
      include: {
        reporter: { select: { name: true, type: true } },
        jobRequest: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // Payments
  async getPayments(skip = 0, take = 50) {
    return this.prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, skip, take });
  }

  // Catalog
  async getCatalog() {
    return this.prisma.serviceCategory.findMany({ include: { services: true } });
  }

  // Country Config
  async getCountryConfigs() {
    return this.prisma.countryConfig.findMany();
  }

  // Reviews
  async getReportedReviews(skip = 0, take = 50) {
    // Real report flags arrive in F6; until then the queue is the lowest ratings, newest first.
    return this.prisma.review.findMany({ where: { rating: 1 }, orderBy: { createdAt: 'desc' }, skip, take });
  }

  // Staff
  async listStaff() {
    return this.prisma.user.findMany({
      where: { type: 'admin' },
      select: { id: true, name: true, email: true, status: true, adminRoles: true, totpEnabledAt: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setRoles(id: string, adminId: string, roles: AdminRole[]) {
    const staff = await this.prisma.user.findFirst({ where: { id, type: 'admin' }, select: { id: true, adminRoles: true } });
    if (!staff) throw new NotFoundException('Staff member not found');
    const unique = [...new Set(roles)];
    if (id === adminId && !unique.includes('Super Admin')) {
      // Prevents locking everyone out of staff management by accident.
      throw new ForbiddenException({ code: 'CANNOT_DEMOTE_SELF', message: 'Ask another Super Admin to change your own roles.' });
    }
    await this.prisma.user.update({ where: { id }, data: { adminRoles: unique } });
    // Live feeds and open pages re-authorise with the new roles.
    if (id !== adminId) await this.sessions.revokeAllExcept(id);
    await this.audit.record({ actorId: adminId, action: 'staff.roles_changed', entityType: 'User', entityId: id, before: { roles: staff.adminRoles }, after: { roles: unique } });
    return { id, roles: unique };
  }

  async resetTwoFactor(id: string, adminId: string, reason: string) {
    const staff = await this.prisma.user.findFirst({ where: { id, type: 'admin' }, select: { id: true } });
    if (!staff) throw new NotFoundException('Staff member not found');
    await this.prisma.user.update({ where: { id }, data: { totpSecret: null, totpEnabledAt: null, totpRecoveryHashes: [] } });
    await this.sessions.revokeAllExcept(id);
    await this.audit.record({ actorId: adminId, action: 'staff.2fa_reset', entityType: 'User', entityId: id, after: { reason } });
    return { id, twoFactor: 'reset' };
  }
}
