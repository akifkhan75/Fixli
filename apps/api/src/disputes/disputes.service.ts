import { StorageService } from '../storage/storage.service';
import { StaffAccessService } from '../common/access/staff-access.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { DomainEvents } from '../common/events/domain-events';

/** Lists never carry storage keys; evidence links come from the detail view. */
const stripKeys = <T extends { evidenceKeys: string[] }>(rows: T[]) =>
  rows.map(({ evidenceKeys, ...r }) => ({ ...r, evidenceCount: evidenceKeys.length }));

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly staff: StaffAccessService,
    private readonly storage: StorageService,
  ) {}

  async createDispute(user: { id: string; type: string }, dto: CreateDisputeDto) {
    await this.access.requireParticipant(dto.jobRequestId, user);
    const dispute = await this.prisma.$transaction(async (tx) => {
      const evidenceKeys = dto.evidenceUploadIds?.length ? await this.storage.consume(user.id, dto.evidenceUploadIds, 'JOB_PHOTO', tx) : [];
      return tx.dispute.create({
        data: {
          jobRequestId: dto.jobRequestId,
          category: dto.category ?? 'OTHER',
          reason: dto.reason,
          description: dto.description,
          amountHeld: dto.amountHeld,
          evidenceKeys,
          raisedById: user.id,
        },
      });
    });
    await this.audit.record({
      actorId: user.id,
      action: 'dispute.opened',
      entityType: 'Dispute',
      entityId: dispute.id,
      after: { jobRequestId: dto.jobRequestId, reason: dto.reason },
    });
    this.events.emit('admin.dispute_opened', {
      disputeId: dispute.id,
      jobId: dispute.jobRequestId,
    });
    return dispute;
  }

  async getDisputeById(id: string, user: { id: string; type: string }) {
    await this.staff.assert(user, 'disputes.read');
    const dispute = await this.prisma.dispute.findFirst({
      where: {
        id,
        ...(user.type === 'admin'
          ? {}
          : {
              OR: [
                { raisedById: user.id },
                { jobRequest: { customerId: user.id } },
                { jobRequest: { assignedWorkerId: user.id } },
              ],
            }),
      },
      include: {
        raisedBy: { select: { id: true, name: true, type: true } },
        jobRequest: { select: { id: true, status: true, description: true } },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const { evidenceKeys, ...rest } = dispute;
    return { ...rest, evidence: await Promise.all(evidenceKeys.map((k) => this.storage.signedUrlForKey(k, 600))) };
  }

  async getUserDisputes(userId: string) {
    return stripKeys(await this.prisma.dispute.findMany({
      where: { raisedById: userId },
      include: { jobRequest: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }));
  }

  async getAllDisputes() {
    return stripKeys(await this.prisma.dispute.findMany({
      include: {
        raisedBy: { select: { id: true, name: true, type: true } },
        jobRequest: { select: { id: true, customerName: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }));
  }

  async updateDisputeStatus(id: string, dto: ResolveDisputeDto, adminId: string) {
    const before = await this.prisma.dispute.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Dispute not found');
    const after = await this.prisma.dispute.update({
      where: { id },
      data: { 
        status: dto.status, 
        resolution: dto.resolution,
        resolvedById: dto.status === 'RESOLVED' ? adminId : undefined,
        resolvedAt: dto.status === 'RESOLVED' ? new Date() : undefined,
      },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'dispute.updated',
      entityType: 'Dispute',
      entityId: id,
      before: { status: before.status, resolution: before.resolution },
      after: { status: after.status, resolution: after.resolution },
    });
    return after;
  }
}
