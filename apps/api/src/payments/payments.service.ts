import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { DomainEvents } from '../common/events/domain-events';
import { NotificationService } from '../notifications/notifications.service';
import { capStatus, commissionConfigFor, computeCommission } from '../common/commission';
import { MarkCashDto } from './dto/payment.dto';

/** A job has at most one of these at a time (enforced by a partial unique index too). */
const LIVE = ['MARKED_BY_WORKER', 'CONFIRMED', 'DISPUTED'];
/** A worker cannot claim more cash than this multiple of the agreed price (change orders may raise it). */
const MAX_OVERPAY_FACTOR = 10;
export const AUTO_CONFIRM_AFTER_MS = 24 * 3_600_000;
/** Reminder stage -> hours after the worker marked cash. */
const REMINDERS: { stage: 1 | 2 | 3; afterMs: number }[] = [
  { stage: 1, afterMs: 2 * 3_600_000 },
  { stage: 2, afterMs: 12 * 3_600_000 },
  { stage: 3, afterMs: 23 * 3_600_000 },
];

interface SettleOpts {
  /** Who is acting; undefined = the system (auto-confirm). */
  customerId?: string;
  auto?: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Worker marks cash received ────────────────────────────────────────────────────────

  async markCashReceived(jobId: string, workerId: string, dto: MarkCashDto) {
    await this.access.requireAssignedWorker(jobId, workerId);
    const job = await this.prisma.jobRequest.findUnique({
      where: { id: jobId },
      select: { id: true, title: true, customerId: true, status: true, agreedAmount: true, agreedCurrency: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (!['AWAITING_CONFIRMATION', 'COMPLETED'].includes(job.status)) {
      throw new BadRequestException({ code: 'JOB_NOT_FINISHED', message: 'Finish the job before recording cash.' });
    }
    if (job.agreedAmount == null || !job.agreedCurrency) {
      throw new BadRequestException({ code: 'NO_AGREED_PRICE', message: 'This job has no agreed price.' });
    }
    if (dto.amount > job.agreedAmount * MAX_OVERPAY_FACTOR) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_HIGH', message: 'That amount is far above the agreed price. Check it and try again.' });
    }

    const existing = await this.findLive(jobId);
    if (existing) return this.sameRequest(existing, dto);

    let payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          jobRequestId: jobId,
          method: 'CASH',
          amount: dto.amount,
          currency: job.agreedCurrency, // never taken from the client
          status: 'MARKED_BY_WORKER',
          idempotencyKey: dto.idempotencyKey,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // A concurrent call (or a retry that lost its response) won the race: return its row.
        const winner = await this.findLive(jobId);
        if (winner) return this.sameRequest(winner, dto);
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'That request key was already used.' });
      }
      throw e;
    }

    await this.audit.record({
      actorId: workerId, action: 'payment.cash_marked', entityType: 'Payment', entityId: payment.id,
      after: { jobId, amount: payment.amount, currency: payment.currency },
    });
    const worker = await this.userName(workerId);
    await this.notifications.notify({
      type: 'payment.confirm_request', userIds: [job.customerId], eventKey: `payment.confirm_request:${payment.id}`,
      params: { worker, title: job.title ?? 'your job', amount: { minor: payment.amount, currency: payment.currency } },
      data: { url: `/(customer)/job/${jobId}`, jobId, paymentId: payment.id },
    });
    this.events.emit('payment.recorded', { jobId });
    return payment;
  }

  // ── Customer confirms / disputes ──────────────────────────────────────────────────────

  confirmPayment(paymentId: string, customerId: string) {
    return this.settle(paymentId, { customerId });
  }

  async disputePayment(paymentId: string, customerId: string, claimedAmount: number) {
    const payment = await this.requireOwnPayment(paymentId, customerId);
    if (payment.status === 'DISPUTED') return payment; // idempotent
    if (payment.status !== 'MARKED_BY_WORKER') {
      throw new BadRequestException({ code: 'PAYMENT_NOT_DISPUTABLE', message: 'This payment can no longer be disputed.' });
    }
    if (claimedAmount >= payment.amount) {
      throw new BadRequestException({ code: 'CLAIM_NOT_LOWER', message: 'If you paid that amount, just confirm the payment.' });
    }
    const workerId = payment.jobRequest.assignedWorkerId!;
    const cfg = await this.configFor(workerId);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockWorker(tx, workerId);
      const moved = await tx.payment.updateMany({
        where: { id: paymentId, status: 'MARKED_BY_WORKER' },
        data: { status: 'DISPUTED', claimedAmount },
      });
      if (moved.count === 0) return null; // someone else decided first
      const dispute = await tx.dispute.create({
        data: {
          jobRequestId: payment.jobRequestId,
          raisedById: customerId,
          category: 'PAYMENT_AMOUNT',
          reason: `Customer says they paid ${claimedAmount}, worker recorded ${payment.amount} (${payment.currency} minor units).`,
          amountHeld: payment.amount - claimedAmount,
        },
      });
      // Commission is charged only on the undisputed minimum; the disputed difference waits for an admin.
      const balanceAfter = await this.postCommission(tx, workerId, payment, Math.min(payment.amount, claimedAmount), cfg, customerId, { disputed: true });
      return { dispute, balanceAfter };
    });
    if (!result) return this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    await this.audit.record({
      actorId: customerId, action: 'payment.disputed', entityType: 'Payment', entityId: paymentId,
      after: { claimedAmount, recorded: payment.amount, disputeId: result.dispute.id },
    });
    this.events.emit('admin.dispute_opened', { disputeId: result.dispute.id, jobId: payment.jobRequestId });
    this.events.emit('payment.recorded', { jobId: payment.jobRequestId });
    await this.enforceCap(workerId, -result.balanceAfter, cfg);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  /** Customer confirmation, or the 24-hour system auto-confirmation. Safe to call twice. */
  async settle(paymentId: string, opts: SettleOpts) {
    const payment = opts.customerId
      ? await this.requireOwnPayment(paymentId, opts.customerId)
      : await this.requirePayment(paymentId);
    if (payment.status === 'CONFIRMED') return payment; // idempotent
    if (payment.status !== 'MARKED_BY_WORKER') {
      throw new BadRequestException({ code: 'PAYMENT_NOT_CONFIRMABLE', message: 'This payment is not waiting for confirmation.' });
    }
    const workerId = payment.jobRequest.assignedWorkerId!;
    const cfg = await this.configFor(workerId);

    const balanceAfter = await this.prisma.$transaction(async (tx) => {
      await this.lockWorker(tx, workerId);
      const moved = await tx.payment.updateMany({
        where: { id: paymentId, status: 'MARKED_BY_WORKER' },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), autoConfirmed: !!opts.auto },
      });
      if (moved.count === 0) return null; // already settled by a concurrent call
      return this.postCommission(tx, workerId, payment, payment.amount, cfg, opts.customerId ?? 'system', opts.auto ? { autoConfirmed: true, reason: 'CUSTOMER_TIMEOUT' } : {});
    });
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (balanceAfter === null) return fresh;

    await this.audit.record({
      actorId: opts.customerId ?? null, action: opts.auto ? 'payment.auto_confirmed' : 'payment.confirmed',
      entityType: 'Payment', entityId: paymentId, after: { amount: payment.amount },
    });
    if (opts.auto) {
      await this.notifications.notify({
        type: 'payment.auto_confirmed', userIds: [payment.jobRequest.customerId], eventKey: `payment.auto_confirmed:${paymentId}`,
        params: { title: payment.jobRequest.title ?? 'your job', amount: { minor: payment.amount, currency: payment.currency } },
        data: { url: `/(customer)/job/${payment.jobRequestId}`, jobId: payment.jobRequestId },
      });
    }
    this.events.emit('payment.recorded', { jobId: payment.jobRequestId });
    await this.enforceCap(workerId, -balanceAfter, cfg);
    return fresh;
  }

  // ── Background: reminders and 24h auto-confirm (called by the sweeper) ───────────────

  async sweepCash(now = new Date()): Promise<{ reminded: number; autoConfirmed: number }> {
    const pending = await this.prisma.payment.findMany({
      where: { method: 'CASH', status: 'MARKED_BY_WORKER' },
      include: { jobRequest: { select: { customerId: true, title: true } } },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
    let reminded = 0;
    let autoConfirmed = 0;
    for (const p of pending) {
      try {
        const age = now.getTime() - p.createdAt.getTime();
        if (age >= AUTO_CONFIRM_AFTER_MS) {
          const done = await this.settle(p.id, { auto: true });
          if (done.autoConfirmed) autoConfirmed++;
          continue;
        }
        const due = [...REMINDERS].reverse().find((r) => age >= r.afterMs && p.reminderStage < r.stage);
        if (!due) continue;
        const claimed = await this.prisma.payment.updateMany({ where: { id: p.id, reminderStage: p.reminderStage }, data: { reminderStage: due.stage } });
        if (claimed.count === 0) continue; // another instance sent it
        await this.notifications.notify({
          type: 'payment.confirm_reminder', userIds: [p.jobRequest.customerId], eventKey: `payment.confirm_reminder:${p.id}:${due.stage}`,
          params: { title: p.jobRequest.title ?? 'your job', amount: { minor: p.amount, currency: p.currency } },
          data: { url: `/(customer)/job/${p.jobRequestId}`, jobId: p.jobRequestId, paymentId: p.id },
        });
        reminded++;
      } catch (e) {
        this.logger.error(`Cash sweep failed for payment ${p.id}: ${(e as Error).message}`);
      }
    }
    return { reminded, autoConfirmed };
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────

  /** Serialises all ledger writes for one worker so balances cannot race. Must run inside `tx`. */
  private lockWorker(tx: Prisma.TransactionClient, workerId: string) {
    return tx.$queryRaw`SELECT "id" FROM "Worker" WHERE "id" = ${workerId} FOR UPDATE`;
  }

  /**
   * Appends the commission entry. The balance is the SUM of entries (not "the latest row"), so
   * it stays correct even if timestamps tie or interleave. The idempotency key makes a repeat a no-op error.
   * Balance convention: negative = the worker owes the platform.
   */
  private async postCommission(
    tx: Prisma.TransactionClient,
    workerId: string,
    payment: { id: string; jobRequestId: string; currency: string },
    baseAmount: number,
    cfg: ReturnType<typeof commissionConfigFor>,
    createdById: string,
    metadata: Record<string, unknown>,
  ): Promise<number> {
    const commission = computeCommission(baseAmount, cfg);
    const { _sum } = await tx.ledgerEntry.aggregate({ where: { workerId }, _sum: { amount: true } });
    const balanceAfter = (_sum.amount ?? 0) - commission;
    await tx.ledgerEntry.create({
      data: {
        workerId,
        jobRequestId: payment.jobRequestId,
        type: 'COMMISSION_OWED',
        amount: -commission,
        currency: payment.currency,
        balanceAfter,
        idempotencyKey: `commission:${payment.id}`,
        metadata: { baseAmount, rateBps: cfg.rateBps, ...metadata } as Prisma.InputJsonValue,
        createdById: createdById === 'system' ? null : createdById,
      },
    });
    return balanceAfter;
  }

  /** Over the hard limit: take the worker offline (never touches jobs already booked). */
  private async enforceCap(workerId: string, owed: number, cfg: ReturnType<typeof commissionConfigFor>) {
    const status = capStatus(owed, cfg);
    if (status === 'OK') return;
    const currency = (await this.prisma.ledgerEntry.findFirst({ where: { workerId }, select: { currency: true }, orderBy: { createdAt: 'desc' } }))?.currency ?? 'PKR';
    const params = { owed: { minor: owed, currency }, limit: { minor: status === 'BLOCKED' ? cfg.hardLimitMinor : cfg.softLimitMinor, currency } };
    if (status === 'BLOCKED') {
      await this.prisma.worker.update({ where: { id: workerId }, data: { isOnline: false } });
    }
    await this.notifications.notify({
      type: status === 'BLOCKED' ? 'worker.commission_blocked' : 'worker.commission_warning',
      userIds: [workerId],
      // One alert per band per day, not per payment.
      eventKey: `worker.commission_${status.toLowerCase()}:${workerId}:${new Date().toISOString().slice(0, 10)}`,
      params, data: { url: '/(worker)/earnings' },
    });
  }

  private async configFor(workerId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: workerId }, select: { countryCode: true } });
    return commissionConfigFor(u?.countryCode);
  }

  private async userName(id: string) {
    return (await this.prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'Your professional';
  }

  private findLive(jobId: string) {
    return this.prisma.payment.findFirst({ where: { jobRequestId: jobId, status: { in: LIVE } } });
  }

  /** A repeat of the same request returns the stored payment; a different one is a conflict. */
  private sameRequest<T extends { amount: number; idempotencyKey: string | null }>(existing: T, dto: MarkCashDto): T {
    const sameKey = !!dto.idempotencyKey && existing.idempotencyKey === dto.idempotencyKey;
    if (sameKey || existing.amount === dto.amount) return existing;
    throw new ConflictException({ code: 'PAYMENT_ALREADY_RECORDED', message: 'Cash was already recorded for this job.' });
  }

  private async requirePayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { jobRequest: { select: { customerId: true, assignedWorkerId: true, title: true } } },
    });
    if (!payment || !payment.jobRequest.assignedWorkerId) throw new NotFoundException('Payment not found');
    return payment;
  }

  private async requireOwnPayment(paymentId: string, customerId: string) {
    const payment = await this.requirePayment(paymentId);
    if (payment.jobRequest.customerId !== customerId) throw new ForbiddenException('Only the customer of this job can do that');
    return payment;
  }
}
