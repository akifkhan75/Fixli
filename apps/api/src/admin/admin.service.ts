import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Users
  async searchUsers(query: string) {
    return this.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, phone: true, email: true, type: true, status: true, createdAt: true },
      take: 50,
    });
  }

  async suspendUser(id: string, adminId: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    await this.audit.record({
      actorId: adminId,
      action: 'user.suspended',
      entityType: 'User',
      entityId: id,
      after: { status: 'SUSPENDED', reason },
    });

    return updated;
  }

  // Jobs
  async getJobsList(status?: string, skip = 0, take = 50) {
    const where = status ? { status: status as any } : {};
    return this.prisma.jobRequest.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        assignedWorker: { select: { user: { select: { name: true, phone: true } } } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  async cancelJob(id: string, adminId: string, reason: string) {
    const current = await this.prisma.jobRequest.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('Job not found');
    // A finished job stays finished: cancelling it would rewrite history (and the payment trail).
    if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
      throw new ConflictException({ code: 'JOB_FINISHED', message: `This job is already ${current.status.toLowerCase()}.` });
    }
    const job = await this.prisma.jobRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await this.audit.record({
      actorId: adminId,
      action: 'job.cancelled',
      entityType: 'JobRequest',
      entityId: id,
      after: { status: 'CANCELLED', reason },
    });

    return job;
  }

  // Audits
  async getAuditLogs(skip = 0, take = 100) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // Safety Incidents
  async getIncidents(status?: string, skip = 0, take = 50) {
    const where = status ? { status } : {};
    return this.prisma.incident.findMany({
      where,
      include: {
        reporter: { select: { name: true, type: true, phone: true } },
        jobRequest: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  /** OPEN -> INVESTIGATING -> RESOLVED. Every change is audited with who and why; a resolved incident is final. */
  async updateIncident(id: string, adminId: string, status: 'INVESTIGATING' | 'RESOLVED', note?: string) {
    if (status === 'RESOLVED' && !note?.trim()) {
      throw new BadRequestException({ code: 'NOTE_REQUIRED', message: 'Write what was done before resolving.' });
    }
    const before = await this.prisma.incident.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new NotFoundException('Incident not found');
    if (before.status === 'RESOLVED') throw new ConflictException({ code: 'INCIDENT_RESOLVED', message: 'This incident is already resolved.' });
    // Conditional on the status we read, so two staff members cannot overwrite each other.
    const r = await this.prisma.incident.updateMany({ where: { id, status: before.status }, data: { status } });
    if (r.count === 0) throw new ConflictException({ code: 'INCIDENT_CHANGED', message: 'Someone else just updated this incident. Refresh.' });
    await this.audit.record({
      actorId: adminId, action: `incident.${status.toLowerCase()}`, entityType: 'Incident', entityId: id,
      before: { status: before.status }, after: { status, note: note?.trim() || undefined },
    });
    return { id, status };
  }

  // Payments
  async getPayments(skip = 0, take = 50) {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // Catalog
  async getCatalog() {
    return this.prisma.serviceCategory.findMany({
      include: {
        services: true,
      },
    });
  }

  // Country Config
  async getCountryConfigs() {
    return this.prisma.countryConfig.findMany();
  }

  // Reviews
  async getReportedReviews(skip = 0, take = 50) {
    return this.prisma.review.findMany({
      where: {
        // Simple logic for reported reviews: rating <= 2 or specific tags?
        // Let's assume we flag reviews with rating 1 for manual moderation
        rating: 1,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }
}
