import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CountryConfigService } from './country-config.service';

/** UTC instant of local midnight on the given local date in `tz`. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass handles a DST change between the guess and the answer
  return new Date(t);
}

/** Start of today / this week (Monday) / this month, in the worker's own timezone. */
export function periodStart(now: Date, tz: string, period: 'day' | 'week' | 'month'): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now).map((x) => [x.type, x.value]));
  let y = +p.year, m = +p.month, d = +p.day;
  if (period === 'month') d = 1;
  if (period === 'week') {
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
    const back = new Date(Date.UTC(y, m - 1, d - dow));
    y = back.getUTCFullYear(); m = back.getUTCMonth() + 1; d = back.getUTCDate();
  }
  return zonedMidnight(y, m, d, tz);
}

/**
 * What the worker earned (cash the customers confirmed), what Fixli's commission was, and what
 * they owe. "Earned" is income, never commission (doc 26 9.4).
 */
@Injectable()
export class EarningsService {
  constructor(private readonly prisma: PrismaService, private readonly countries: CountryConfigService) {}

  private async totals(workerId: string, since: Date) {
    const [paid, commission] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'CONFIRMED', confirmedAt: { gte: since }, jobRequest: { assignedWorkerId: workerId } },
        _sum: { amount: true }, _count: true,
      }),
      this.prisma.ledgerEntry.aggregate({ where: { workerId, type: 'COMMISSION_OWED', createdAt: { gte: since } }, _sum: { amount: true } }),
    ]);
    const gross = paid._sum.amount ?? 0;
    const fee = commission._sum.amount ?? 0;
    return { gross, commission: fee, net: gross - fee, jobs: paid._count };
  }

  async summary(workerId: string, period: 'week' | 'month' = 'week', now = new Date()) {
    const worker = await this.prisma.worker.findUniqueOrThrow({
      where: { id: workerId },
      select: { timezone: true, ledgerBalance: true, owedSince: true, balanceBlocked: true },
    });
    const country = await this.countries.forWorker(workerId);
    const tz = worker.timezone || 'Asia/Karachi';
    const start = periodStart(now, tz, period);
    const [periodTotals, today, pendingSettlement] = await Promise.all([
      this.totals(workerId, start),
      this.totals(workerId, periodStart(now, tz, 'day')),
      this.prisma.settlement.findFirst({ where: { workerId, status: 'PENDING' }, select: { id: true, amount: true, createdAt: true } }),
    ]);
    const owed = worker.ledgerBalance;
    return {
      currency: country.currency,
      period, periodStart: start.toISOString(),
      ...periodTotals,
      today,
      owed,
      owedSince: worker.owedSince?.toISOString() ?? null,
      limits: {
        softMinor: country.cashLimits.softMinor,
        hardMinor: country.cashLimits.hardMinor,
        maxDaysOwed: country.cashLimits.maxDaysOwed,
        overSoft: owed >= country.cashLimits.softMinor,
        blocked: worker.balanceBlocked,
      },
      commissionRule: country.commission,
      settlementRails: country.settlementRails,
      pendingSettlement,
    };
  }

  async ledger(workerId: string, cursor?: string, limit = 30) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { workerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(limit, 50) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, type: true, amount: true, currency: true, balanceAfter: true, jobRequestId: true, note: true, createdAt: true, jobRequest: { select: { title: true } } },
    });
    const take = Math.min(limit, 50);
    const items = rows.slice(0, take).map(({ jobRequest, ...r }) => ({ ...r, jobTitle: jobRequest?.title ?? null }));
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }
}
