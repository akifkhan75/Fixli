import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CHANGE_ORDER_STATUSES, JobStatus } from '../jobs/job-state-machine';
import { CreateChangeOrderDto } from './dto/change-order.dto';

/**
 * Extra work found on site (doc 24 Phase 8). The worker proposes a new total; nothing changes
 * until the customer approves, and then the job's agreed price becomes that total (what the cash
 * step and commission use). One proposal at a time per job; currency is always the job's.
 */
@Injectable()
export class ChangeOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(workerId: string, dto: CreateChangeOrderDto) {
    const job = await this.access.requireAssignedWorker(dto.jobRequestId, workerId);
    if (!CHANGE_ORDER_STATUSES.includes(job.status as JobStatus)) {
      throw new ConflictException({ code: 'JOB_NOT_ACTIVE', message: 'Extra work can only be requested on an active job.' });
    }
    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the job so two proposals can't both pass the "nothing pending" check.
      const [locked] = await tx.$queryRaw<{ agreedAmount: number | null; agreedCurrency: string | null; currency: string; title: string | null; customerId: string }[]>`
        SELECT "agreedAmount", "agreedCurrency", "currency", "title", "customerId" FROM "JobRequest" WHERE id = ${dto.jobRequestId} FOR UPDATE`;
      const pending = await tx.changeOrder.count({ where: { jobRequestId: dto.jobRequestId, status: 'PENDING' } });
      if (pending) throw new ConflictException({ code: 'CHANGE_ORDER_PENDING', message: 'Wait for the customer to answer the current request first.' });
      if (locked.agreedAmount != null && dto.revisedPrice === locked.agreedAmount) {
        throw new ConflictException({ code: 'SAME_PRICE', message: 'The new total is the same as the current price.' });
      }
      const mediaKeys = dto.photoUploadIds?.length ? await this.storage.consume(workerId, dto.photoUploadIds, 'JOB_PHOTO', tx) : [];
      const co = await tx.changeOrder.create({
        data: {
          jobRequestId: dto.jobRequestId,
          reason: dto.reason.trim(),
          addedScope: dto.addedScope.trim(),
          revisedPrice: dto.revisedPrice,
          currency: locked.agreedCurrency ?? locked.currency,
          mediaKeys,
          status: 'PENDING',
        },
      });
      await tx.jobEvent.create({ data: { jobRequestId: dto.jobRequestId, actorId: workerId, type: 'CHANGE_ORDER_PROPOSED', payload: { changeOrderId: co.id, from: locked.agreedAmount, to: dto.revisedPrice, currency: co.currency } } });
      return { co, customerId: locked.customerId, title: locked.title };
    });
    await this.tell(created.customerId, 'change_order.created', created.co, created.title, `/(customer)/job/${dto.jobRequestId}`);
    this.realtime.emitToUsers([created.customerId, workerId], 'job.updated', { jobId: dto.jobRequestId });
    return this.present(created.co);
  }

  async findByJob(jobId: string, user: { id: string; type: string }) {
    await this.access.requireParticipant(jobId, user);
    const rows = await this.prisma.changeOrder.findMany({ where: { jobRequestId: jobId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return Promise.all(rows.map((r) => this.present(r)));
  }

  async updateStatus(id: string, customerId: string, status: 'APPROVED' | 'REJECTED') {
    const result = await this.prisma.$transaction(async (tx) => {
      const co = await tx.changeOrder.findFirst({
        where: { id, jobRequest: { customerId } },
        include: { jobRequest: { select: { id: true, status: true, agreedAmount: true, title: true, assignedWorkerId: true } } },
      });
      if (!co) throw new NotFoundException('Change order not found');
      if (status === 'APPROVED' && !CHANGE_ORDER_STATUSES.includes(co.jobRequest.status as JobStatus)) {
        throw new ConflictException({ code: 'JOB_NOT_ACTIVE', message: 'This job is no longer in progress.' });
      }
      const decided = await tx.changeOrder.updateMany({
        where: { id, status: 'PENDING' },
        data: { status, decidedAt: new Date(), ...(status === 'APPROVED' ? { previousPrice: co.jobRequest.agreedAmount } : {}) },
      });
      if (decided.count === 0) throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'This change order has already been decided.' });
      if (status === 'APPROVED') {
        // The new total becomes the price the cash step and commission use.
        await tx.jobRequest.update({ where: { id: co.jobRequestId }, data: { agreedAmount: co.revisedPrice, agreedCurrency: co.currency } });
      }
      await tx.jobEvent.create({
        data: {
          jobRequestId: co.jobRequestId, actorId: customerId,
          type: status === 'APPROVED' ? 'CHANGE_ORDER_APPROVED' : 'CHANGE_ORDER_DECLINED',
          payload: { changeOrderId: id, from: co.jobRequest.agreedAmount, to: status === 'APPROVED' ? co.revisedPrice : co.jobRequest.agreedAmount, currency: co.currency },
        },
      });
      return { co: await tx.changeOrder.findUniqueOrThrow({ where: { id } }), job: co.jobRequest };
    });
    await this.audit.record({ actorId: customerId, action: `change_order.${status.toLowerCase()}`, entityType: 'ChangeOrder', entityId: id, before: { price: result.job.agreedAmount }, after: { price: status === 'APPROVED' ? result.co.revisedPrice : result.job.agreedAmount } });
    if (result.job.assignedWorkerId) {
      await this.tell(result.job.assignedWorkerId, status === 'APPROVED' ? 'change_order.approved' : 'change_order.declined', result.co, result.job.title, `/(worker)/job/${result.job.id}`);
    }
    this.realtime.emitToUsers([customerId, result.job.assignedWorkerId ?? ''], 'job.updated', { jobId: result.job.id });
    return this.present(result.co);
  }

  private tell(userId: string, type: 'change_order.created' | 'change_order.approved' | 'change_order.declined', co: { id: string; revisedPrice: number; currency: string; jobRequestId: string }, title: string | null, url: string) {
    return this.notifications.notify({
      type, userIds: [userId], eventKey: `${type}:${co.id}`,
      params: { title: title ?? 'your job', price: { minor: co.revisedPrice, currency: co.currency } },
      data: { url, jobId: co.jobRequestId },
    });
  }

  /** Photos go out as short-lived signed links; keys stay on the server. */
  private async present<T extends { mediaKeys: string[] }>(co: T) {
    const { mediaKeys, ...rest } = co;
    return { ...rest, photos: await Promise.all(mediaKeys.map((k) => this.storage.signedUrlForKey(k, 600))) };
  }
}
