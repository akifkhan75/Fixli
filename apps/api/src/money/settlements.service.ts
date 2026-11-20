import { routes } from '@fixli/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DomainEvents } from '../common/events/domain-events';
import { LedgerService } from './ledger.service';
import { CountryConfigService } from './country-config.service';

/**
 * Settling up (doc 22 §11.8): the worker pays what they owe through a country rail (JazzCash,
 * Easypaisa, bank) and reports the reference; Finance checks it and confirms, which reduces the
 * balance (and lifts a pause). Nothing changes on the ledger until Finance confirms.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly countries: CountryConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly events: DomainEvents,
  ) {}

  async report(workerId: string, dto: { amount: number; rail: string; reference: string }) {
    const [worker, country] = await Promise.all([
      this.prisma.worker.findUnique({ where: { id: workerId }, select: { ledgerBalance: true, currency: true } }),
      this.countries.forWorker(workerId),
    ]);
    if (!worker) throw new NotFoundException('Worker not found');
    if (!country.settlementRails.some((r) => r.id === dto.rail)) {
      throw new BadRequestException({ code: 'UNKNOWN_RAIL', message: 'Choose one of the listed payment methods.' });
    }
    if (worker.ledgerBalance <= 0) throw new ConflictException({ code: 'NOTHING_OWED', message: "You don't owe anything right now." });
    if (dto.amount > worker.ledgerBalance) {
      throw new BadRequestException({ code: 'MORE_THAN_OWED', message: 'That is more than you owe.' });
    }
    const pending = await this.prisma.settlement.count({ where: { workerId, status: 'PENDING' } });
    if (pending) throw new ConflictException({ code: 'SETTLEMENT_PENDING', message: 'Your last payment is still being checked.' });

    const s = await this.prisma.settlement.create({
      data: { workerId, amount: dto.amount, currency: country.currency, rail: dto.rail, reference: dto.reference.trim(), status: 'PENDING' },
    });
    await this.audit.record({ actorId: workerId, action: 'settlement.reported', entityType: 'Settlement', entityId: s.id, after: { amount: s.amount, rail: s.rail } });
    this.events.emit('admin.settlement_reported', { settlementId: s.id, workerId });
    return s;
  }

  listMine(workerId: string) {
    return this.prisma.settlement.findMany({ where: { workerId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  listForStaff(status?: string) {
    return this.prisma.settlement.findMany({
      where: status ? { status } : {},
      include: { worker: { select: { ledgerBalance: true, user: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async decide(id: string, staffId: string, approve: boolean, note?: string) {
    const out = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.settlement.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'COMPLETED' : 'FAILED', reviewedById: staffId, reviewedAt: new Date(), note: note?.trim() || null },
      });
      if (claimed.count === 0) {
        if (!(await tx.settlement.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Settlement not found');
        throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'This payment was already checked.' });
      }
      const s = await tx.settlement.findUniqueOrThrow({ where: { id } });
      if (approve) {
        await this.ledger.post(tx, {
          workerId: s.workerId, type: 'COMMISSION_SETTLED', amount: -s.amount, currency: s.currency,
          idempotencyKey: `settlement:${s.id}`, createdById: staffId, note: `${s.rail} ${s.reference}`,
        });
      }
      return s;
    });
    await this.audit.record({ actorId: staffId, action: approve ? 'settlement.confirmed' : 'settlement.rejected', entityType: 'Settlement', entityId: id, after: { amount: out.amount, note } });
    await this.notifications.notify({
      type: approve ? 'settlement.confirmed' : 'settlement.rejected', userIds: [out.workerId], eventKey: `settlement:${id}`,
      params: { price: { minor: out.amount, currency: out.currency }, reason: note?.trim() || undefined },
      data: { url: routes.workerEarnings() },
    });
    this.realtime.emitToUsers([out.workerId], 'job.updated', { settlementId: id });
    return out;
  }
}
