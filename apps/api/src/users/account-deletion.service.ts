import { ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SessionService } from '../auth/session.service';
import { JobsService } from '../jobs/jobs.service';
import { AuditService } from '../common/audit/audit.service';

/** Work in progress or unsettled money: the account cannot vanish in the middle of it. */
const ACTIVE_WORK = ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'] as const;
/** Not started yet: safe to cancel on the user's behalf (the other side is notified). */
const NOT_STARTED = ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED'] as const;
export const DELETED_NAME = 'Deleted user';
const REMOVED_TEXT = '[removed]';

export type DeletionBlocker = 'JOB_IN_PROGRESS' | 'PAYMENT_PENDING' | 'DISPUTE_OPEN' | 'COMMISSION_OWED';
const BLOCKER_TEXT: Record<DeletionBlocker, string> = {
  JOB_IN_PROGRESS: 'You have a job in progress. Finish or cancel it first.',
  PAYMENT_PENDING: 'A cash payment is waiting to be confirmed or reviewed.',
  DISPUTE_OPEN: 'You have an open dispute. Wait until it is resolved.',
  COMMISSION_OWED: 'You still owe Fixli fees. Settle your balance first.',
};

/**
 * Account deletion for store compliance and privacy law (doc 26 §3.3, doc 27 R4):
 * re-authenticate -> refuse while money/work is unsettled -> cancel not-yet-started jobs ->
 * sign out everywhere -> erase or anonymise personal data in ONE transaction -> delete files.
 * Financial records (payments, ledger) are kept, tied to an anonymous "Deleted user".
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sessions: SessionService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  async blockers(userId: string): Promise<DeletionBlocker[]> {
    const mine = { OR: [{ customerId: userId }, { assignedWorkerId: userId }] };
    const [work, payments, disputes, ledger] = await Promise.all([
      this.prisma.jobRequest.count({ where: { ...mine, status: { in: [...ACTIVE_WORK] } } }),
      this.prisma.payment.count({ where: { status: { in: ['MARKED_BY_WORKER', 'DISPUTED'] }, jobRequest: mine } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] }, OR: [{ raisedById: userId }, { jobRequest: mine }] } }),
      this.prisma.ledgerEntry.aggregate({ where: { workerId: userId }, _sum: { amount: true } }),
    ]);
    const out: DeletionBlocker[] = [];
    if (work) out.push('JOB_IN_PROGRESS');
    if (payments) out.push('PAYMENT_PENDING');
    if (disputes) out.push('DISPUTE_OPEN');
    if ((ledger._sum.amount ?? 0) < 0) out.push('COMMISSION_OWED');
    return out;
  }

  async deleteAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, type: true, status: true, password: true } });
    if (!user) throw new UnauthorizedException();
    if (user.status === 'DELETED') return { success: true }; // idempotent
    if (user.type === 'admin') {
      throw new ForbiddenException({ code: 'ADMIN_ACCOUNT', message: 'Staff accounts are removed by another administrator.' });
    }
    if (!(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Your password is wrong.' });
    }

    const blocked = await this.blockers(userId);
    if (blocked.length) {
      throw new ConflictException({ code: 'DELETION_BLOCKED', message: BLOCKER_TEXT[blocked[0]], details: blocked });
    }

    // Jobs that have not started are cancelled for the user; the other side is told.
    const open = await this.prisma.jobRequest.findMany({
      where: { status: { in: [...NOT_STARTED] }, OR: [{ customerId: userId }, { assignedWorkerId: userId }] },
      select: { id: true },
    });
    const actor = { id: userId, type: user.type } as any;
    for (const j of open) {
      try { await this.jobs.cancel(j.id, actor, { reason: 'OTHER', note: 'The account was deleted.' }); }
      catch (e) { this.logger.warn(`Could not cancel job ${j.id} for deleted account: ${(e as Error).message}`); }
    }
    // The state may have moved while we cancelled: check again before erasing anything.
    const again = await this.blockers(userId);
    if (again.length) throw new ConflictException({ code: 'DELETION_BLOCKED', message: BLOCKER_TEXT[again[0]], details: again });

    await this.sessions.revokeAllExcept(userId); // also cuts live sockets and push

    const keys = await this.prisma.$transaction(async (tx) => this.erase(tx, userId));
    await this.storage.removeKeys(keys); // after commit: a file that fails to delete never blocks the erasure

    await this.audit.record({ actorId: userId, action: 'account.deleted', entityType: 'User', entityId: userId, after: { type: user.type, files: keys.length } });
    return { success: true };
  }

  /** Runs inside the transaction. Returns the storage keys to delete afterwards. */
  private async erase(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], userId: string): Promise<string[]> {
    const keys = new Set<string>();
    const own = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { profileImageUrl: true, type: true } });
    if (own.profileImageUrl && !/^https?:/.test(own.profileImageUrl)) keys.add(own.profileImageUrl);
    (await tx.upload.findMany({ where: { ownerId: userId }, select: { key: true } })).forEach((u) => keys.add(u.key));

    const mediaWhere = { OR: [{ createdById: userId }, { jobRequest: { customerId: userId } }] };
    (await tx.jobMedia.findMany({ where: mediaWhere, select: { storageKey: true } })).forEach((m) => keys.add(m.storageKey));
    (await tx.message.findMany({ where: { senderId: userId, imageKey: { not: null } }, select: { imageKey: true } })).forEach((m) => m.imageKey && keys.add(m.imageKey));

    if (own.type === 'worker') {
      (await tx.portfolioItem.findMany({ where: { workerId: userId }, select: { photoKeys: true } })).forEach((p) => p.photoKeys.forEach((k) => keys.add(k)));
      (await tx.verificationCase.findMany({ where: { workerId: userId }, select: { documentKeys: true } })).forEach((v) => v.documentKeys.forEach((k) => keys.add(k)));
    }

    await tx.jobMedia.deleteMany({ where: mediaWhere });
    await tx.upload.deleteMany({ where: { ownerId: userId } });
    await tx.jobAiAnalysis.deleteMany({ where: { ownerId: userId } });
    await tx.message.updateMany({ where: { senderId: userId }, data: { text: REMOVED_TEXT, imageKey: null } });
    await tx.jobRequest.updateMany({
      where: { customerId: userId },
      data: { customerName: DELETED_NAME, description: REMOVED_TEXT, location: null, latitude: null, longitude: null, area: null, addressId: null },
    });
    await tx.review.updateMany({ where: { reviewerId: userId }, data: { comment: null } });
    await tx.incident.updateMany({ where: { reporterId: userId }, data: { description: null, latitude: null, longitude: null } });
    await tx.address.deleteMany({ where: { userId } });
    await tx.trustedContact.deleteMany({ where: { userId } });
    await tx.favoriteWorker.deleteMany({ where: { OR: [{ customerId: userId }, { workerId: userId }] } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    await tx.session.deleteMany({ where: { userId } });

    if (own.type === 'worker') {
      await tx.offer.updateMany({ where: { workerId: userId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
      await tx.portfolioItem.deleteMany({ where: { workerId: userId } });
      await tx.verificationCase.deleteMany({ where: { workerId: userId } });
      await tx.workingHours.deleteMany({ where: { workerId: userId } });
      await tx.workerService.deleteMany({ where: { workerId: userId } });
      await tx.worker.update({
        where: { id: userId },
        data: { isOnline: false, isVerified: false, activationStatus: 'INACTIVE', bio: null, serviceLat: null, serviceLng: null, serviceAreaLabel: null, languages: [], equipment: [] },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED', name: DELETED_NAME, email: null, phone: `deleted-${userId}`, profileImageUrl: null,
        totpSecret: null, failedLoginAttempts: 0, lockoutUntil: null,
        // Unusable credential: nobody can ever log in as this row again.
        password: await bcrypt.hash(randomBytes(32).toString('hex'), 4),
      },
    });
    return [...keys];
  }
}
