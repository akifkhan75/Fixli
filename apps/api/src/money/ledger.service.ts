import { routes } from '@fixli/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CashLimits, CountryConfigService } from './country-config.service';
import { NotificationService } from '../notifications/notifications.service';

export type LedgerType = 'COMMISSION_OWED' | 'COMMISSION_SETTLED' | 'ADJUSTMENT';

export interface LedgerPost {
  workerId: string;
  type: LedgerType;
  /** Change in what the worker owes: + more debt, - less. */
  amount: number;
  currency: string;
  /** Same key = same real event: posted once, whatever the retries. */
  idempotencyKey: string;
  jobRequestId?: string | null;
  note?: string;
  createdById?: string | null;
}

/** Over the hard limit, or owing for longer than allowed: pause new work until settled. */
export function isBlocked(balance: number, owedSince: Date | null, limits: CashLimits, now = new Date()): boolean {
  if (balance <= 0) return false;
  if (balance >= limits.hardMinor) return true;
  return !!owedSince && now.getTime() - owedSince.getTime() > limits.maxDaysOwed * 86_400_000;
}

/**
 * The commission ledger. Every write locks the worker row, so the running balance is exact even
 * with simultaneous confirmations on several API instances, and each real event (one job's
 * commission, one settlement) can be booked once only.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countries: CountryConfigService,
    private readonly notifications: NotificationService,
  ) {}

  /** Call inside the caller's transaction. Returns the entry (existing one if already posted). */
  async post(tx: Prisma.TransactionClient, p: LedgerPost) {
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (existing) return { entry: existing, duplicate: true, becameBlocked: false };

    const [w] = await tx.$queryRaw<{ ledgerBalance: number; owedSince: Date | null; balanceBlocked: boolean }[]>`
      SELECT "ledgerBalance", "owedSince", "balanceBlocked" FROM "Worker" WHERE id = ${p.workerId} FOR UPDATE`;
    // Re-check under the lock: a concurrent post with the same key may have just committed.
    const raced = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (raced) return { entry: raced, duplicate: true, becameBlocked: false };

    const balance = w.ledgerBalance + p.amount;
    const owedSince = balance <= 0 ? null : w.ledgerBalance <= 0 ? new Date() : w.owedSince;
    const limits = (await this.countries.forWorker(p.workerId)).cashLimits;
    const blocked = isBlocked(balance, owedSince, limits);
    await tx.worker.update({
      where: { id: p.workerId },
      data: { ledgerBalance: balance, owedSince, balanceBlocked: blocked },
    });
    const entry = await tx.ledgerEntry.create({
      data: {
        workerId: p.workerId, type: p.type, amount: p.amount, currency: p.currency, balanceAfter: balance,
        idempotencyKey: p.idempotencyKey, jobRequestId: p.jobRequestId ?? null, note: p.note, createdById: p.createdById ?? null,
      },
    });
    return { entry, duplicate: false, becameBlocked: blocked && !w.balanceBlocked };
  }

  /** Tell the worker why new work stopped (after the transaction that paused them commits). */
  notifyPaused(workerId: string, key: string) {
    return this.notifications.notify({ type: 'balance.paused', userIds: [workerId], eventKey: `balance.paused:${key}`, params: {}, data: { url: routes.workerEarnings() } });
  }

  /** Daily-ish: workers who have owed for too long get paused (the hard limit applies at once). */
  async refreshBlocks(now = new Date()): Promise<number> {
    const owing = await this.prisma.worker.findMany({
      where: { ledgerBalance: { gt: 0 }, balanceBlocked: false },
      select: { id: true, ledgerBalance: true, owedSince: true },
      take: 1000,
    });
    let n = 0;
    for (const w of owing) {
      const limits = (await this.countries.forWorker(w.id)).cashLimits;
      if (isBlocked(w.ledgerBalance, w.owedSince, limits, now)) {
        const r = await this.prisma.worker.updateMany({ where: { id: w.id, balanceBlocked: false }, data: { balanceBlocked: true } });
        if (r.count) { n++; await this.notifyPaused(w.id, `${w.id}:${w.owedSince?.getTime() ?? 0}`); }
      }
    }
    return n;
  }
}
