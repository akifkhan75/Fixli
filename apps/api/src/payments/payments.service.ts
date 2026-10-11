import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { computeCommission } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { DomainEvents } from '../common/events/domain-events';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LedgerService } from '../money/ledger.service';
import { CountryConfigService } from '../money/country-config.service';

const CASH_DONE_STATUSES = ['AWAITING_CONFIRMATION', 'COMPLETED'];

/**
 * Cash on completion (doc 22 §11.8, doc 25 D13):
 *  1. the worker marks "cash received": always the job's agreed total, once per job;
 *  2. the customer confirms (or, after CASH_AUTO_CONFIRM_HOURS, the system does), and Fixli's
 *     commission is booked on the worker's ledger exactly once;
 *  3. or the customer says "I didn't pay that": the payment is disputed, no commission is charged.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly countries: CountryConfigService,
    private readonly config: ConfigService,
  ) {}

  async markCashReceived(jobId: string, workerId: string) {
    await this.access.requireAssignedWorker(jobId, workerId);
    const job = await this.prisma.jobRequest.findUniqueOrThrow({
      where: { id: jobId },
      select: { status: true, agreedAmount: true, agreedCurrency: true, customerId: true, title: true },
    });
    if (!CASH_DONE_STATUSES.includes(job.status)) {
      throw new BadRequestException({ code: 'JOB_NOT_FINISHED', message: 'Finish the work before marking cash received.' });
    }
    if (!job.agreedAmount || !job.agreedCurrency) {
      throw new ConflictException({ code: 'NO_AGREED_PRICE', message: 'This job has no agreed price.' });
    }

    const existing = await this.prisma.payment.findUnique({ where: { jobRequestId_method: { jobRequestId: jobId, method: 'CASH' } } });
    if (existing) return existing; // idempotent: a second tap changes nothing

    let payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          jobRequestId: jobId, method: 'CASH', amount: job.agreedAmount, currency: job.agreedCurrency,
          status: 'MARKED_BY_WORKER', markedById: workerId, markedAt: new Date(),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return this.prisma.payment.findUniqueOrThrow({ where: { jobRequestId_method: { jobRequestId: jobId, method: 'CASH' } } });
      throw e;
    }
    await this.prisma.jobEvent.create({ data: { jobRequestId: jobId, actorId: workerId, type: 'CASH_MARKED', payload: { amount: payment.amount, currency: payment.currency } } });
    await this.notifications.notify({
      type: 'payment.cash_marked', userIds: [job.customerId], eventKey: `payment.cash_marked:${payment.id}`,
      params: { title: job.title ?? 'your job', price: { minor: payment.amount, currency: payment.currency } },
      data: { url: `/(customer)/job/${jobId}`, jobId },
    });
    this.realtime.emitToUsers([job.customerId, workerId], 'job.updated', { jobId });
    return payment;
  }

  async confirmPayment(paymentId: string, customerId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { jobRequest: { select: { customerId: true } } } });
    if (!payment || payment.jobRequest.customerId !== customerId) throw new NotFoundException('Payment not found');
    return this.confirm(paymentId, customerId, false);
  }

  /** Support resolved a payment dispute: the cash was paid after all (books commission), or not. */
  async settleDisputed(paymentId: string, staffId: string, outcome: 'CONFIRM' | 'VOID') {
    if (outcome === 'CONFIRM') return this.confirm(paymentId, staffId, false, 'DISPUTED');
    const r = await this.prisma.payment.updateMany({ where: { id: paymentId, status: 'DISPUTED' }, data: { status: 'VOIDED' } });
    if (r.count === 0) throw new ConflictException({ code: 'PAYMENT_NOT_DISPUTED', message: 'This payment is not in dispute.' });
    return this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  /** Customer, system or support. Race-safe and idempotent: commission is booked once, whoever wins. */
  private async confirm(paymentId: string, actorId: string | null, auto: boolean, from: 'MARKED_BY_WORKER' | 'DISPUTED' = 'MARKED_BY_WORKER') {
    const result = await this.prisma.$transaction(async (tx) => {
      const won = await tx.payment.updateMany({
        where: { id: paymentId, status: from },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), autoConfirmed: auto },
      });
      const p = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { jobRequest: { select: { id: true, assignedWorkerId: true, title: true, customerId: true } } },
      });
      if (won.count === 0) {
        if (p.status === 'CONFIRMED') return { payment: p, fresh: false, commission: 0, becameBlocked: false };
        throw new ConflictException({ code: 'PAYMENT_NOT_PENDING', message: 'This payment is no longer waiting for confirmation.' });
      }
      const workerId = p.jobRequest.assignedWorkerId!;
      const country = await this.countries.forWorker(workerId);
      // Floor/ceiling are in the country's currency; a job in another currency gets the rate only.
      const rule = p.currency === country.currency ? country.commission : { ...country.commission, minMinor: 0, maxMinor: Number.MAX_SAFE_INTEGER };
      const commission = computeCommission(p.amount, rule);
      const booked = await this.ledger.post(tx, {
        workerId, type: 'COMMISSION_OWED', amount: commission, currency: p.currency,
        idempotencyKey: `commission:${p.jobRequestId}`, jobRequestId: p.jobRequestId, createdById: actorId,
        note: `${(rule.rateBps / 100).toFixed(1)}% of ${p.amount}`,
      });
      await tx.jobEvent.create({ data: { jobRequestId: p.jobRequestId, actorId, type: auto ? 'CASH_AUTO_CONFIRMED' : 'CASH_CONFIRMED', payload: { amount: p.amount, currency: p.currency, commission } } });
      return { payment: p, fresh: true, commission, becameBlocked: booked.becameBlocked };
    });

    if (result.fresh) {
      const p = result.payment;
      const workerId = p.jobRequest.assignedWorkerId!;
      await this.notifications.notify({
        type: auto ? 'payment.auto_confirmed' : 'payment.confirmed', userIds: [workerId], eventKey: `payment.confirmed:${p.id}`,
        params: { title: p.jobRequest.title ?? 'your job', price: { minor: p.amount, currency: p.currency }, commission: { minor: result.commission, currency: p.currency } },
        data: { url: `/(worker)/job/${p.jobRequestId}`, jobId: p.jobRequestId },
      });
      this.realtime.emitToUsers([p.jobRequest.customerId, workerId], 'job.updated', { jobId: p.jobRequestId });
      if (result.becameBlocked) await this.ledger.notifyPaused(workerId, p.id);
    }
    const { jobRequest, ...payment } = result.payment;
    return payment;
  }

  /** "I didn't pay that" / "the amount is wrong": no commission; ops sorts it out (F6). */
  async disputePayment(paymentId: string, customerId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { jobRequest: { select: { id: true, customerId: true, assignedWorkerId: true, title: true } } } });
    if (!payment || payment.jobRequest.customerId !== customerId) throw new NotFoundException('Payment not found');
    const dispute = await this.prisma.$transaction(async (tx) => {
      const r = await tx.payment.updateMany({ where: { id: paymentId, status: 'MARKED_BY_WORKER' }, data: { status: 'DISPUTED' } });
      if (r.count === 0) throw new ConflictException({ code: 'PAYMENT_NOT_PENDING', message: 'This payment can no longer be disputed here. Please contact support.' });
      return tx.dispute.create({
        data: { jobRequestId: payment.jobRequestId, raisedById: customerId, category: 'PAYMENT', reason: reason.trim(), paymentId, amountHeld: payment.amount },
      });
    });
    this.events.emit('admin.dispute_opened', { disputeId: dispute.id, jobId: payment.jobRequestId });
    if (payment.jobRequest.assignedWorkerId) {
      await this.notifications.notify({
        type: 'payment.disputed', userIds: [payment.jobRequest.assignedWorkerId], eventKey: `payment.disputed:${paymentId}`,
        params: { title: payment.jobRequest.title ?? 'your job' }, data: { url: `/(worker)/job/${payment.jobRequestId}`, jobId: payment.jobRequestId },
      });
    }
    this.realtime.emitToUsers([customerId, payment.jobRequest.assignedWorkerId ?? ''], 'job.updated', { jobId: payment.jobRequestId });
    return { paymentId, status: 'DISPUTED', disputeId: dispute.id };
  }

  /** Cash marked but not confirmed for CASH_AUTO_CONFIRM_HOURS, no open dispute: confirm it. */
  async autoConfirmDue(now = new Date()): Promise<number> {
    const hours = Number(this.config.get('CASH_AUTO_CONFIRM_HOURS') ?? 48);
    const due = await this.prisma.payment.findMany({
      where: {
        method: 'CASH', status: 'MARKED_BY_WORKER', markedAt: { lte: new Date(now.getTime() - hours * 3600_000) },
        jobRequest: { disputes: { none: { status: { in: ['OPEN', 'IN_REVIEW'] } } } },
      },
      select: { id: true }, take: 100,
    });
    let n = 0;
    for (const p of due) {
      try { await this.confirm(p.id, null, true); n++; } catch { /* changed meanwhile */ }
    }
    return n;
  }
}
