import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MilestoneStatus, Prisma } from '@prisma/client';
import { computeCommission, routes } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LedgerService } from '../money/ledger.service';
import { CountryConfigService } from '../money/country-config.service';
import { DomainEvents } from '../common/events/domain-events';
import { CARD_GATEWAY, CardEvent, CardGateway } from '../payments/card.gateway';
import type { NotificationType } from '../notifications/templates';
import { assertMove, currentMilestone, isDone, MilestoneActor } from './project-state';
import { StageDisputeDto, SubmitStageDto } from './projects.dto';

const WITH_PROJECT = {
  project: { select: { id: true, title: true, status: true, paymentMode: true, currency: true, customerId: true, awardedWorkerId: true } },
} as const;
type Stage = Prisma.ProjectMilestoneGetPayload<{ include: typeof WITH_PROJECT }>;

const CHECKOUT_MINUTES = 60;

/** What changed in a release, so notifications go out after the transaction commits. */
interface Released { commission: number; becameBlocked: boolean; completed: boolean }

/**
 * Project stages and their money.
 *  ESCROW: customer pays a stage by card (held by Fixli) -> work -> customer approves -> the
 *          professional is credited the amount minus Fixli's fee on their ledger.
 *  DIRECT: work -> customer approves and pays the professional themselves -> the professional
 *          confirms receipt -> only Fixli's fee is booked on their ledger.
 * Every status change is conditional on the status it was read in, and every ledger line has a key
 * naming the real event, so retries and races can't move money twice.
 */
@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly countries: CountryConfigService,
    private readonly events: DomainEvents,
    private readonly config: ConfigService,
    @Inject(CARD_GATEWAY) private readonly cards: CardGateway,
  ) {}

  private async load(id: string, userId: string, role: 'customer' | 'worker' | 'either'): Promise<Stage> {
    const m = await this.prisma.projectMilestone.findUnique({ where: { id }, include: WITH_PROJECT });
    const isCustomer = m?.project.customerId === userId;
    const isWorker = m?.project.awardedWorkerId === userId;
    if (!m || !(isCustomer || isWorker) || (role === 'customer' && !isCustomer) || (role === 'worker' && !isWorker)) {
      throw new NotFoundException('Stage not found');
    }
    return m;
  }

  private async requireCurrent(m: Stage) {
    if (!['AWARDED', 'IN_PROGRESS'].includes(m.project.status)) throw new ConflictException({ code: 'PROJECT_CLOSED', message: 'This project is closed.' });
    const all = await this.prisma.projectMilestone.findMany({ where: { projectId: m.projectId }, select: { id: true, position: true, status: true } });
    if (currentMilestone(all)?.id !== m.id) throw new ConflictException({ code: 'NOT_CURRENT_STAGE', message: 'Finish the earlier stage first.' });
  }

  /** Conditional status change; false when someone else got there first. */
  private async move(db: Prisma.TransactionClient, m: Stage, to: MilestoneStatus, actor: MilestoneActor, data: Prisma.ProjectMilestoneUpdateManyMutationInput = {}) {
    assertMove(m.status, to, actor, m.project.paymentMode);
    const r = await db.projectMilestone.updateMany({ where: { id: m.id, status: m.status }, data: { ...data, status: to } });
    return r.count === 1;
  }

  private changed() {
    return new ConflictException({ code: 'STAGE_CHANGED', message: 'This stage just changed. Please refresh.' });
  }

  private async tell(m: Stage, to: 'customer' | 'worker', type: NotificationType, key: string, params: Record<string, string | number | { minor: number; currency: string }> = {}) {
    const userId = to === 'customer' ? m.project.customerId : m.project.awardedWorkerId;
    if (!userId) return;
    await this.notifications.notify({
      type, userIds: [userId], eventKey: `${type}:${key}`,
      params: { title: m.project.title, stage: m.title, price: { minor: m.amount, currency: m.project.currency }, ...params },
      data: { url: to === 'customer' ? routes.customerProject(m.projectId) : routes.workerProject(m.projectId), projectId: m.projectId },
    });
  }

  private refresh(m: Stage) {
    this.realtime.emitToUsers([m.project.customerId, m.project.awardedWorkerId ?? ''], 'project.updated', { projectId: m.projectId });
  }

  // ── Funding (escrow) ───────────────────────────────────────

  async fund(milestoneId: string, customerId: string) {
    const m = await this.load(milestoneId, customerId, 'customer');
    if (m.project.paymentMode !== 'ESCROW') throw new ConflictException({ code: 'DIRECT_PAYMENT', message: 'You pay this professional directly.' });
    if (m.status !== 'PENDING') throw this.changed();
    await this.requireCurrent(m);
    const live = await this.prisma.projectPayment.findFirst({ where: { milestoneId, status: 'PENDING', checkoutExpiresAt: { gt: new Date(Date.now() + 60_000) } }, orderBy: { createdAt: 'desc' } });
    // One open payment page per stage: tapping "Pay" again reopens it instead of risking two charges.
    if (live?.checkoutUrl) return { checkoutUrl: live.checkoutUrl };

    const attempt = await this.prisma.projectPayment.count({ where: { milestoneId } });
    const key = `fund:${milestoneId}:${attempt + 1}`;
    const checkout = await this.cards.createCheckout({
      amountMinor: m.amount, currency: m.project.currency, description: `${m.project.title}: ${m.title}`,
      reference: milestoneId, idempotencyKey: key, expiresInMinutes: CHECKOUT_MINUTES,
      returnUrl: `${this.config.get<string>('PUBLIC_API_URL')}/payments/card/return`,
    });
    await this.prisma.projectPayment.upsert({
      where: { providerRef: checkout.providerRef },
      create: { milestoneId, method: 'CARD', amount: m.amount, currency: m.project.currency, status: 'PENDING', provider: this.cards.name, providerRef: checkout.providerRef, checkoutUrl: checkout.url, checkoutExpiresAt: checkout.expiresAt },
      update: {},
    });
    return { checkoutUrl: checkout.url };
  }

  /** The card provider's signed word that money arrived (or didn't). Safe to receive twice. */
  async applyCardEvent(event: CardEvent): Promise<void> {
    const payment = await this.prisma.projectPayment.findUnique({ where: { providerRef: event.providerRef }, include: { milestone: { include: WITH_PROJECT } } });
    if (!payment) { this.logger.warn(`Card event for an unknown payment ${event.providerRef}`); return; }
    if (event.type !== 'PAID') {
      await this.prisma.projectPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: event.type } });
      this.refresh(payment.milestone);
      return;
    }
    const m = payment.milestone;
    const matches = event.amountMinor === payment.amount && event.currency === payment.currency;
    const funded = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.projectPayment.updateMany({
        where: { id: payment.id, status: { in: ['PENDING', 'EXPIRED', 'FAILED'] } },
        data: { status: 'REFUND_PENDING', providerPaymentId: event.providerPaymentId, paidAt: new Date() },
      });
      if (!claimed.count) return null; // already handled
      // Money for a stage that was cancelled or already paid goes straight back.
      const ok = matches && (await tx.projectMilestone.updateMany({
        where: { id: m.id, status: 'PENDING', project: { status: { in: ['AWARDED', 'IN_PROGRESS'] } } },
        data: { status: 'FUNDED', fundedAt: new Date() },
      })).count === 1;
      if (ok) await tx.projectPayment.update({ where: { id: payment.id }, data: { status: 'HELD' } });
      return ok;
    });
    if (funded === null) return;
    if (funded) {
      await this.tell(m, 'worker', 'project.stage_funded', payment.id);
    } else {
      if (!matches) this.logger.error(`Card payment ${payment.id} amount mismatch: refunding`);
      await this.sendRefunds();
    }
    this.refresh(m);
  }

  /** Return money marked for refund. The provider ignores repeats of the same key. */
  async sendRefunds(): Promise<number> {
    const due = await this.prisma.projectPayment.findMany({ where: { status: 'REFUND_PENDING', providerPaymentId: { not: null } }, take: 50, include: { milestone: { include: WITH_PROJECT } } });
    let n = 0;
    for (const p of due) {
      try {
        await this.cards.refund({ providerPaymentId: p.providerPaymentId!, amountMinor: p.amount, idempotencyKey: `refund:${p.id}` });
      } catch (e) {
        this.logger.error(`Refund ${p.id} not sent yet: ${(e as Error).message}`);
        continue;
      }
      await this.prisma.projectPayment.updateMany({ where: { id: p.id, status: 'REFUND_PENDING' }, data: { status: 'REFUNDED', refundedAt: new Date() } });
      await this.tell(p.milestone, 'customer', 'project.refunded', p.id);
      this.refresh(p.milestone);
      n++;
    }
    return n;
  }

  // ── Work ───────────────────────────────────────────────────

  async start(milestoneId: string, workerId: string) {
    const m = await this.load(milestoneId, workerId, 'worker');
    if (m.status === 'IN_PROGRESS') return { status: m.status };
    await this.requireCurrent(m);
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.move(tx, m, 'IN_PROGRESS', 'worker', { startedAt: new Date() }))) throw this.changed();
      await tx.project.updateMany({ where: { id: m.projectId, status: 'AWARDED' }, data: { status: 'IN_PROGRESS' } });
    });
    await this.tell(m, 'customer', 'project.stage_started', m.id);
    this.refresh(m);
    return { status: 'IN_PROGRESS' as const };
  }

  async submit(milestoneId: string, workerId: string, dto: SubmitStageDto) {
    const m = await this.load(milestoneId, workerId, 'worker');
    if (m.status === 'SUBMITTED') return { status: m.status };
    if (!dto.photoUploadIds?.length && !dto.note?.trim()) {
      throw new ConflictException({ code: 'SHOW_THE_WORK', message: 'Add a photo of the work, or say what you did.' });
    }
    assertMove(m.status, 'SUBMITTED', 'worker', m.project.paymentMode);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const keys = dto.photoUploadIds?.length ? await this.storage.consume(workerId, dto.photoUploadIds, 'JOB_PHOTO', tx) : [];
      const ok = await this.move(tx, m, 'SUBMITTED', 'worker', { submittedAt: now, submittedNote: dto.note?.trim() || null, evidenceKeys: [...m.evidenceKeys, ...keys].slice(-12), changesNote: null });
      if (!ok) throw this.changed();
    });
    await this.tell(m, 'customer', 'project.stage_submitted', `${m.id}:${now.getTime()}`);
    this.refresh(m);
    return { status: 'SUBMITTED' as const };
  }

  async requestChanges(milestoneId: string, customerId: string, note: string) {
    const m = await this.load(milestoneId, customerId, 'customer');
    if (!(await this.move(this.prisma, m, 'IN_PROGRESS', 'customer', { changesNote: note.trim() }))) throw this.changed();
    await this.tell(m, 'worker', 'project.changes_requested', `${m.id}:${Date.now()}`);
    this.refresh(m);
    return { status: 'IN_PROGRESS' as const };
  }

  async approve(milestoneId: string, customerId: string) {
    const m = await this.load(milestoneId, customerId, 'customer');
    if (m.status === 'APPROVED' || m.status === 'RELEASED') return { status: m.status };
    return this.accept(m, 'customer');
  }

  private async accept(m: Stage, actor: 'customer' | 'system') {
    const result = await this.prisma.$transaction(async (tx) => {
      if (!(await this.move(tx, m, 'APPROVED', actor, { approvedAt: new Date() }))) throw this.changed();
      // Held money moves as soon as the work is accepted; a direct payment waits for the professional.
      return m.project.paymentMode === 'ESCROW' ? this.release(tx, { ...m, status: 'APPROVED' }, 'system') : null;
    });
    if (result) await this.afterRelease(m, result);
    else await this.tell(m, 'worker', 'project.stage_approved', m.id);
    this.refresh(m);
    return { status: result ? 'RELEASED' as const : 'APPROVED' as const };
  }

  /** DIRECT: "I received this payment". */
  async markPaid(milestoneId: string, workerId: string) {
    const m = await this.load(milestoneId, workerId, 'worker');
    if (m.status === 'RELEASED') return { status: m.status };
    if (m.project.paymentMode !== 'DIRECT') throw new ForbiddenException('Fixli releases this payment');
    const result = await this.prisma.$transaction((tx) => this.release(tx, m, 'worker'));
    await this.afterRelease(m, result);
    this.refresh(m);
    return { status: 'RELEASED' as const };
  }

  /** The one place project money reaches the ledger. */
  private async release(tx: Prisma.TransactionClient, m: Stage, actor: MilestoneActor): Promise<Released> {
    if (!(await this.move(tx, m, 'RELEASED', actor, { releasedAt: new Date() }))) throw this.changed();
    const workerId = m.project.awardedWorkerId!;
    const currency = m.project.currency;
    const country = await this.countries.forWorker(workerId);
    // Floor/ceiling are in the country's currency; another currency gets the rate only.
    const rule = currency === country.currency ? country.commission : { ...country.commission, minMinor: 0, maxMinor: Number.MAX_SAFE_INTEGER };
    const commission = computeCommission(m.amount, rule);
    const note = `${m.project.title} · ${m.title}`.slice(0, 300);

    if (m.project.paymentMode === 'ESCROW') {
      const held = await tx.projectPayment.updateMany({ where: { milestoneId: m.id, status: 'HELD' }, data: { status: 'RELEASED', commission, releasedAt: new Date() } });
      if (held.count !== 1) throw new ConflictException({ code: 'NO_MONEY_HELD', message: 'There is no held payment for this stage. Please contact support.' });
      // Fixli holds the money: credit all of it (negative = Fixli owes the professional), then take the fee.
      await this.ledger.post(tx, { workerId, type: 'ESCROW_CREDIT', amount: -m.amount, currency, idempotencyKey: `escrow:${m.id}`, note });
    } else {
      await tx.projectPayment.create({ data: { milestoneId: m.id, method: 'DIRECT', amount: m.amount, currency, status: 'RELEASED', commission, paidAt: new Date(), releasedAt: new Date() } });
    }
    const fee = await this.ledger.post(tx, { workerId, type: 'COMMISSION_OWED', amount: commission, currency, idempotencyKey: `commission:stage:${m.id}`, note });
    const completed = await this.closeIfFinished(tx, m.projectId);
    return { commission, becameBlocked: fee.becameBlocked, completed };
  }

  /** All stages finished: the project is done (or cancelled, if nothing was ever completed). */
  private async closeIfFinished(tx: Prisma.TransactionClient, projectId: string): Promise<boolean> {
    const stages = await tx.projectMilestone.findMany({ where: { projectId }, select: { status: true } });
    if (!stages.length || !stages.every((s) => isDone(s.status))) return false;
    const done = stages.some((s) => s.status === 'RELEASED');
    const r = await tx.project.updateMany({
      where: { id: projectId, status: { in: ['AWARDED', 'IN_PROGRESS'] } },
      data: done ? { status: 'COMPLETED', completedAt: new Date() } : { status: 'CANCELLED' },
    });
    if (done) await tx.conversation.updateMany({ where: { projectId }, data: { lastMessageAt: new Date() } });
    return done && r.count === 1;
  }

  private async afterRelease(m: Stage, r: Released) {
    await this.tell(m, 'worker', 'project.stage_paid', m.id, { commission: { minor: r.commission, currency: m.project.currency } });
    if (r.becameBlocked) await this.ledger.notifyPaused(m.project.awardedWorkerId!, `stage:${m.id}`);
    if (r.completed) {
      await this.tell(m, 'customer', 'project.completed', `${m.projectId}:customer`);
      await this.tell(m, 'worker', 'project.completed', `${m.projectId}:worker`);
    }
  }

  // ── Problems ───────────────────────────────────────────────

  async dispute(milestoneId: string, userId: string, dto: StageDisputeDto) {
    const m = await this.load(milestoneId, userId, 'either');
    const actor = userId === m.project.customerId ? 'customer' : 'worker';
    const dispute = await this.prisma.$transaction(async (tx) => {
      if (!(await this.move(tx, m, 'DISPUTED', actor))) throw this.changed();
      return tx.dispute.create({
        data: { projectId: m.projectId, milestoneId: m.id, raisedById: userId, category: 'OTHER', reason: dto.reason.trim(), description: dto.description?.trim(), amountHeld: m.amount },
      });
    });
    this.events.emit('admin.dispute_opened', { disputeId: dispute.id, projectId: m.projectId });
    await this.tell(m, actor === 'customer' ? 'worker' : 'customer', 'project.disputed', dispute.id);
    this.refresh(m);
    return { disputeId: dispute.id, status: 'DISPUTED' as const };
  }

  /**
   * Support's decision on a disputed stage: RELEASE pays the professional, REFUND returns held money
   * and cancels the stage, RESUME sends it back to work.
   */
  async resolveDispute(milestoneId: string, outcome: 'RELEASE' | 'REFUND' | 'RESUME') {
    const m = await this.prisma.projectMilestone.findUnique({ where: { id: milestoneId }, include: WITH_PROJECT });
    if (!m) throw new NotFoundException('Stage not found');
    if (m.status !== 'DISPUTED') throw this.changed();
    const released = await this.prisma.$transaction(async (tx) => {
      if (outcome === 'RELEASE') return this.release(tx, m, 'admin');
      if (outcome === 'RESUME') {
        // Back to work; escrow money stays held.
        if (!(await this.move(tx, m, 'IN_PROGRESS', 'admin'))) throw this.changed();
        await tx.project.updateMany({ where: { id: m.projectId, status: 'AWARDED' }, data: { status: 'IN_PROGRESS' } });
        return null;
      }
      if (!(await this.move(tx, m, 'CANCELLED', 'admin'))) throw this.changed();
      await tx.projectPayment.updateMany({ where: { milestoneId: m.id, status: 'HELD' }, data: { status: 'REFUND_PENDING' } });
      await this.closeIfFinished(tx, m.projectId);
      return null;
    });
    if (released) await this.afterRelease(m, released);
    if (outcome === 'REFUND') await this.sendRefunds();
    this.refresh(m);
  }

  // ── Silence ────────────────────────────────────────────────

  /**
   * A customer who doesn't answer for PROJECT_AUTO_APPROVE_DAYS has accepted the stage; a direct
   * payment left unconfirmed that long after approval is treated as paid. Disputed stages wait.
   */
  async autoApproveDue(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - Number(this.config.get('PROJECT_AUTO_APPROVE_DAYS') ?? 7) * 86_400_000);
    const due = await this.prisma.projectMilestone.findMany({
      where: { OR: [{ status: 'SUBMITTED', submittedAt: { lte: before } }, { status: 'APPROVED', approvedAt: { lte: before }, project: { paymentMode: 'DIRECT' } }] },
      include: WITH_PROJECT, take: 100,
    });
    let n = 0;
    for (const m of due) {
      try {
        if (m.status === 'SUBMITTED') await this.accept(m, 'system');
        else {
          const r = await this.prisma.$transaction((tx) => this.release(tx, m, 'system'));
          await this.afterRelease(m, r);
          this.refresh(m);
        }
        n++;
      } catch (e) { this.logger.warn(`Stage ${m.id} not auto-closed: ${(e as Error).message}`); }
    }
    return n;
  }
}
