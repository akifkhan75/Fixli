import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { DomainEvents } from '../common/events/domain-events';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async createDispute(user: { id: string; type: string }, dto: CreateDisputeDto) {
    await this.access.requireParticipant(dto.jobRequestId, user);
    // One open dispute per person per job: a second tap or a retry returns the existing one.
    const open = await this.prisma.dispute.findFirst({
      where: { jobRequestId: dto.jobRequestId, raisedById: user.id, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    if (open) throw new ConflictException({ code: 'DISPUTE_EXISTS', message: 'You already have an open report for this job. We are looking into it.', details: { disputeId: open.id } });
    const dispute = await this.prisma.dispute.create({
      data: {
        jobRequestId: dto.jobRequestId,
        category: dto.category ?? 'OTHER',
        reason: dto.reason,
        description: dto.description,
        raisedById: user.id,
      },
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
    return dispute;
  }

  getUserDisputes(userId: string) {
    return this.prisma.dispute.findMany({
      where: { raisedById: userId },
      include: { jobRequest: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  getAllDisputes() {
    return this.prisma.dispute.findMany({
      include: {
        raisedBy: { select: { id: true, name: true, type: true } },
        jobRequest: { select: { id: true, customerName: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
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
