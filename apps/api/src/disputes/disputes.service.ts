import { routes } from '@fixli/shared';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LedgerService } from '../money/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { StorageService } from '../storage/storage.service';
import { StaffAccessService } from '../common/access/staff-access.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { DomainEvents } from '../common/events/domain-events';
import { MilestonesService } from '../projects/milestones.service';

const STATUS_TEXT: Record<string, string> = { IN_REVIEW: 'support is looking into it', RESOLVED: 'resolved', CLOSED: 'closed' };

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
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly milestones: MilestonesService,
  ) {}

  async createDispute(user: { id: string; type: string }, dto: CreateDisputeDto) {
    const job = await this.access.requireParticipant(dto.jobRequestId, user);
    const details = await this.prisma.jobRequest.findUniqueOrThrow({ where: { id: job.id }, select: { agreedAmount: true, title: true } });
    if (dto.amountHeld != null && details.agreedAmount != null && dto.amountHeld > details.agreedAmount) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_HIGH', message: 'The amount in question cannot be more than the job price.' });
    }
    const open = await this.prisma.dispute.count({ where: { jobRequestId: job.id, status: { in: ['OPEN', 'IN_REVIEW'] } } });
    if (open) throw new ConflictException({ code: 'DISPUTE_OPEN', message: 'A problem is already being looked at for this job.' });
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
      jobId: job.id,
    });
    // Reopen the job's chat while the problem is looked at.
    await this.prisma.conversation.updateMany({ where: { jobRequestId: job.id, isReadOnly: true }, data: { isReadOnly: false, closedAt: null } });
    // The other party hears about it (and job screens refresh). An open dispute pauses auto-confirm.
    const other = user.id === job.customerId ? job.assignedWorkerId : job.customerId;
    if (other) {
      await this.notifications.notify({
        type: 'dispute.opened', userIds: [other], eventKey: `dispute.opened:${dispute.id}`, params: { title: details.title ?? 'your job' },
        data: { url: routes.jobFor(job.id, other === job.customerId ? 'customer' : 'worker'), jobId: job.id },
      });
    }
    this.realtime.emitToUsers([job.customerId, job.assignedWorkerId ?? ''], 'job.updated', { jobId: job.id });
    const { evidenceKeys, ...rest } = dispute;
    return { ...rest, evidenceCount: evidenceKeys.length };
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
                { project: { customerId: user.id } },
                { project: { awardedWorkerId: user.id } },
              ],
            }),
      },
      include: {
        raisedBy: { select: { id: true, name: true, type: true } },
        jobRequest: { select: { id: true, status: true, description: true } },
        project: { select: { id: true, status: true, title: true } },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const { evidenceKeys, ...rest } = dispute;
    return { ...rest, evidence: await Promise.all(evidenceKeys.map((k) => this.storage.signedUrlForKey(k, 600))) };
  }

  async getUserDisputes(userId: string) {
    return stripKeys(await this.prisma.dispute.findMany({
      where: { raisedById: userId },
      include: { jobRequest: { select: { id: true, status: true } }, project: { select: { id: true, status: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }));
  }

  async getAllDisputes() {
    return stripKeys(await this.prisma.dispute.findMany({
      include: {
        raisedBy: { select: { id: true, name: true, type: true } },
        jobRequest: { select: { id: true, customerName: true, status: true } },
        project: { select: { id: true, title: true, status: true, customer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })).map(({ project, ...d }) => (project
      // The console lists every dispute the same way; a project stands in the job column.
      ? { ...d, jobRequest: { id: project.id, customerName: project.customer.name, status: project.status }, projectTitle: project.title }
      : d));
  }

  async updateDisputeStatus(id: string, dto: ResolveDisputeDto, adminId: string) {
    const before = await this.prisma.dispute.findUnique({ where: { id }, include: { jobRequest: { select: { id: true, title: true, customerId: true, assignedWorkerId: true } } } });
    if (!before) throw new NotFoundException('Dispute not found');
    if (before.status === 'RESOLVED' || before.status === 'CLOSED') {
      throw new ConflictException({ code: 'DISPUTE_CLOSED', message: 'This dispute is already closed.' });
    }
    if (before.projectId) return this.updateProjectDispute(before, dto, adminId);
    if (dto.stageOutcome) throw new BadRequestException({ code: 'NOT_A_PROJECT_DISPUTE', message: 'This dispute is not about a project stage.' });
    const jobRequestId = before.jobRequestId!;
    const jobRequest = before.jobRequest!;
    if (dto.ledgerAdjustment) await this.staff.assert({ id: adminId, type: 'admin' }, 'finance.adjust');
    if (dto.paymentOutcome && !before.paymentId) throw new BadRequestException({ code: 'NOT_A_PAYMENT_DISPUTE', message: 'This dispute is not about a payment.' });
    const closing = dto.status === 'RESOLVED' || dto.status === 'CLOSED';
    if ((dto.paymentOutcome || dto.ledgerAdjustment) && !closing) {
      throw new BadRequestException({ code: 'RESOLVE_TO_APPLY', message: 'Money changes are applied when the dispute is resolved.' });
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const r = await tx.dispute.updateMany({
        where: { id, status: before.status },
        data: {
          status: dto.status,
          resolution: dto.resolution,
          resolvedById: closing ? adminId : undefined,
          resolvedAt: closing ? new Date() : undefined,
        },
      });
      if (r.count === 0) throw new ConflictException({ code: 'DISPUTE_CHANGED', message: 'Someone else just updated this dispute. Refresh and try again.' });
      if (dto.ledgerAdjustment && jobRequest.assignedWorkerId) {
        const job = await tx.jobRequest.findUniqueOrThrow({ where: { id: jobRequestId }, select: { agreedCurrency: true, currency: true } });
        await this.ledger.post(tx, {
          workerId: jobRequest.assignedWorkerId, type: 'ADJUSTMENT', amount: dto.ledgerAdjustment.amount,
          currency: job.agreedCurrency ?? job.currency, idempotencyKey: `dispute:${id}:adjustment`,
          jobRequestId: jobRequestId, createdById: adminId, note: dto.ledgerAdjustment.note,
        });
      }
      return tx.dispute.findUniqueOrThrow({ where: { id } });
    });
    // Commission for a disputed payment is booked (or not) through the payments rules, once.
    if (dto.paymentOutcome && before.paymentId) await this.payments.settleDisputed(before.paymentId, adminId, dto.paymentOutcome);

    await this.audit.record({
      actorId: adminId,
      action: 'dispute.updated',
      entityType: 'Dispute',
      entityId: id,
      before: { status: before.status, resolution: before.resolution },
      after: { status: after.status, resolution: after.resolution, paymentOutcome: dto.paymentOutcome, adjustment: dto.ledgerAdjustment },
    });
    const parties = [jobRequest.customerId, jobRequest.assignedWorkerId].filter((u): u is string => !!u);
    // Each side gets a link to their own job screen.
    for (const u of parties) {
      await this.notifications.notify({
        type: 'dispute.updated', userIds: [u], eventKey: `dispute.updated:${id}:${dto.status}`,
        params: { title: jobRequest.title ?? 'your job', status: STATUS_TEXT[dto.status] },
        data: { url: routes.jobFor(jobRequestId, u === jobRequest.customerId ? 'customer' : 'worker'), jobId: jobRequestId },
      });
    }
    this.realtime.emitToUsers(parties, 'job.updated', { jobId: jobRequestId });
    const { evidenceKeys, ...rest } = after;
    return { ...rest, evidenceCount: evidenceKeys.length };
  }

  /** A disputed project stage: closing it requires saying what happens to the stage and its money. */
  private async updateProjectDispute(
    before: { id: string; status: string; projectId: string | null; milestoneId: string | null; resolution: string | null; paymentId: string | null },
    dto: ResolveDisputeDto,
    adminId: string,
  ) {
    if (dto.paymentOutcome) throw new BadRequestException({ code: 'NOT_A_PAYMENT_DISPUTE', message: 'This dispute is not about a cash payment.' });
    if (dto.ledgerAdjustment) throw new BadRequestException({ code: 'USE_STAGE_OUTCOME', message: 'Choose what happens to the stage; use a ledger adjustment on the professional for anything extra.' });
    const closing = dto.status === 'RESOLVED' || dto.status === 'CLOSED';
    const milestone = before.milestoneId ? await this.prisma.projectMilestone.findUnique({ where: { id: before.milestoneId }, select: { status: true } }) : null;
    if (closing && milestone?.status === 'DISPUTED') {
      if (!dto.stageOutcome) throw new BadRequestException({ code: 'STAGE_OUTCOME_REQUIRED', message: 'Choose: pay the professional, refund the customer, or send the stage back to work.' });
      await this.staff.assert({ id: adminId, type: 'admin' }, 'finance.adjust');
      // Money moves first: if it cannot, the dispute stays open to try again.
      await this.milestones.resolveDispute(before.milestoneId!, dto.stageOutcome);
    }
    const r = await this.prisma.dispute.updateMany({
      where: { id: before.id, status: before.status },
      data: { status: dto.status, resolution: dto.resolution, resolvedById: closing ? adminId : undefined, resolvedAt: closing ? new Date() : undefined },
    });
    if (r.count === 0) throw new ConflictException({ code: 'DISPUTE_CHANGED', message: 'Someone else just updated this dispute. Refresh and try again.' });
    const [after, project] = await Promise.all([
      this.prisma.dispute.findUniqueOrThrow({ where: { id: before.id } }),
      this.prisma.project.findUniqueOrThrow({ where: { id: before.projectId! }, select: { id: true, title: true, customerId: true, awardedWorkerId: true } }),
    ]);
    await this.audit.record({
      actorId: adminId, action: 'dispute.updated', entityType: 'Dispute', entityId: before.id,
      before: { status: before.status, resolution: before.resolution },
      after: { status: after.status, resolution: after.resolution, stageOutcome: dto.stageOutcome },
    });
    const parties = [project.customerId, project.awardedWorkerId].filter((u): u is string => !!u);
    for (const u of parties) {
      await this.notifications.notify({
        type: 'dispute.updated', userIds: [u], eventKey: `dispute.updated:${before.id}:${dto.status}`,
        params: { title: project.title, status: STATUS_TEXT[dto.status] },
        data: { url: u === project.customerId ? routes.customerProject(project.id) : routes.workerProject(project.id), projectId: project.id },
      });
    }
    this.realtime.emitToUsers(parties, 'project.updated', { projectId: project.id });
    const { evidenceKeys, ...rest } = after;
    return { ...rest, evidenceCount: evidenceKeys.length };
  }

}
