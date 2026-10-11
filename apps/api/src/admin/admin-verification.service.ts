import { routes } from '@fixli/shared';
import { NotificationService } from '../notifications/notifications.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../common/audit/audit.service';
import { latestCases } from '../workers/onboarding';
import { VerificationDecisionDto, VerificationQueryDto } from './dto/admin.dto';

@Injectable()
export class AdminVerificationService {
  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(q: VerificationQueryDto) {
    const limit = q.limit ?? 20;
    const rows = await this.prisma.verificationCase.findMany({
      where: { status: q.status ?? 'SUBMITTED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // oldest first: fair queue
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true, type: true, status: true, createdAt: true, reference: true,
        worker: { select: { id: true, activationStatus: true, user: { select: { name: true, phone: true } } } },
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  /** Case detail with short-lived links to the private documents. Every view is audited (CNIC rules, doc 22 L2). */
  async detail(id: string, adminId: string) {
    const c = await this.prisma.verificationCase.findUnique({
      where: { id },
      include: {
        worker: {
          select: {
            id: true, activationStatus: true, isVerified: true, createdAt: true,
            user: { select: { name: true, phone: true, countryCode: true } },
            verifications: { orderBy: { createdAt: 'desc' }, select: { id: true, type: true, status: true, createdAt: true, reason: true } },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Case not found');
    const documents = await Promise.all(c.documentKeys.map(async (key) => ({ url: await this.storage.signedUrlForKey(key, 300) })));
    await this.audit.record({ actorId: adminId, action: 'verification.documents_viewed', entityType: 'VerificationCase', entityId: id });
    const { documentKeys, ...rest } = c;
    return { ...rest, documents };
  }

  async decide(id: string, adminId: string, dto: VerificationDecisionDto) {
    if (dto.decision !== 'APPROVE' && !dto.reason?.trim()) {
      throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Please tell the worker what to fix.' });
    }
    const status = dto.decision === 'APPROVE' ? 'APPROVED' : dto.decision === 'REJECT' ? 'REJECTED' : 'NEEDS_INFO';

    // Only an open case can be decided, once.
    const claimed = await this.prisma.verificationCase.updateMany({
      where: { id, status: 'SUBMITTED' },
      data: { status, reviewerId: adminId, reviewedAt: new Date(), reason: dto.reason?.trim() || null },
    });
    if (claimed.count === 0) {
      const exists = await this.prisma.verificationCase.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException('Case not found');
      throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'Someone already reviewed this case.' });
    }
    const c = await this.prisma.verificationCase.findUniqueOrThrow({ where: { id }, select: { workerId: true, type: true } });
    await this.audit.record({ actorId: adminId, action: `verification.${status.toLowerCase()}`, entityType: 'VerificationCase', entityId: id, after: { workerId: c.workerId, type: c.type, reason: dto.reason } });

    await this.notifications.notify({
      type: status === 'APPROVED' ? 'verification.approved' : 'verification.needs_fix',
      userIds: [c.workerId], eventKey: `verification:${id}`,
      params: { doc: c.type, reason: dto.reason?.trim() || undefined },
      data: { url: routes.workerDocuments() },
    });
    await this.syncWorkerStatus(c.workerId);
    return { id, status };
  }

  /**
   * A worker becomes ACTIVE (and "verified") only when the latest ID and SELFIE cases are both
   * approved. A rejected/needs-info case sends a pending worker back to fix it.
   */
  private async syncWorkerStatus(workerId: string) {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId }, select: { activationStatus: true } });
    if (!worker || worker.activationStatus !== 'PENDING_REVIEW') return;

    const cases = latestCases(await this.prisma.verificationCase.findMany({ where: { workerId }, orderBy: { createdAt: 'desc' }, select: { type: true, status: true } }));
    const state = (t: string) => cases.find((c) => c.type === t)?.status;

    if (state('ID') === 'APPROVED' && state('SELFIE') === 'APPROVED') {
      await this.prisma.worker.update({ where: { id: workerId }, data: { activationStatus: 'ACTIVE', isVerified: true } });
      await this.audit.record({ action: 'worker.activated', entityType: 'Worker', entityId: workerId });
      await this.notifications.notify({ type: 'worker.activated', userIds: [workerId], eventKey: `worker.activated:${workerId}`, params: {}, data: { url: routes.workerToday() } });
    } else if (['REJECTED', 'NEEDS_INFO'].some((s) => state('ID') === s || state('SELFIE') === s)) {
      await this.prisma.worker.update({ where: { id: workerId }, data: { activationStatus: 'ONBOARDING' } });
    }
  }

  async stats() {
    const [users, workersByStatus, jobsByStatus, openDisputes, pendingVerifications] = await Promise.all([
      this.prisma.user.groupBy({ by: ['type'], _count: true }),
      this.prisma.worker.groupBy({ by: ['activationStatus'], _count: true }),
      this.prisma.jobRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.verificationCase.count({ where: { status: 'SUBMITTED' } }),
    ]);
    const toMap = <T extends string>(rows: { _count: number }[] , key: string) =>
      Object.fromEntries((rows as any[]).map((r) => [r[key] as T, r._count]));
    return {
      users: toMap(users, 'type'),
      workers: toMap(workersByStatus, 'activationStatus'),
      jobs: toMap(jobsByStatus, 'status'),
      openDisputes,
      pendingVerifications,
    };
  }
}
