import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { AdminService } from './admin.service';
import { LedgerService } from '../money/ledger.service';
import { CountryConfigService } from '../money/country-config.service';
import { FeatureFlagsService, FlagKey, FLAGS } from '../common/flags/feature-flags.service';
import { permissionsFor } from '../common/auth/permissions';
import {
  AdjustmentDto, AuditQuery, CountryConfigDto, CreateStaffDto, IncidentListQuery, IncidentUpdateDto, IssueDto,
  ModerateReviewDto, PaymentQuery, PriceBandDto, UpdateCategoryContentDto,
} from './dto/console.dto';

const admin = (id: string) => ({ id, type: 'admin' as const });
const page = <T extends { id: string }>(rows: T[], take: number) => ({ items: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id : null });
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/**
 * The staff portal's back end (doc 24 Phase 11, doc 27 F6). Every read and write is on real data;
 * every change is audited; every route has one permission (admin-console.controller.ts).
 */
@Injectable()
export class AdminConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly ledger: LedgerService,
    private readonly countries: CountryConfigService,
    private readonly flags: FeatureFlagsService,
    private readonly users: AdminService,
  ) {}

  async me(adminId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { id: true, name: true, email: true, adminRoles: true, totpEnabledAt: true } });
    return { ...u, permissions: permissionsFor(u.adminRoles) };
  }

  // ── dashboard ──────────────────────────────────────────────
  async dashboard(fromIso?: string, toIso?: string) {
    const to = toIso ? new Date(toIso) : new Date();
    const from = fromIso ? new Date(fromIso) : new Date(to.getTime() - 7 * 86_400_000);
    const inRange = { gte: from, lt: to };
    const [usersByType, onlineWorkers, jobsByStatus, created, booked, cancels, openDisputes, openIncidents, gmv, owed, settled, firstOffers] = await Promise.all([
      this.prisma.user.groupBy({ by: ['type'], where: { status: 'ACTIVE' }, _count: true }),
      this.prisma.worker.count({ where: { isOnline: true, activationStatus: 'ACTIVE' } }),
      this.prisma.jobRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.jobRequest.count({ where: { createdAt: inRange } }),
      this.prisma.jobRequest.count({ where: { createdAt: inRange, bookedAt: { not: null } } }),
      this.prisma.jobRequest.groupBy({ by: ['cancelReason'], where: { status: 'CANCELLED', updatedAt: inRange }, _count: true }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.incident.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
      this.prisma.payment.groupBy({ by: ['currency'], where: { status: 'CONFIRMED', confirmedAt: inRange }, _sum: { amount: true }, _count: true }),
      this.prisma.worker.aggregate({ where: { ledgerBalance: { gt: 0 } }, _sum: { ledgerBalance: true }, _count: true }),
      this.prisma.ledgerEntry.aggregate({ where: { type: 'COMMISSION_SETTLED', createdAt: inRange }, _sum: { amount: true } }),
      this.prisma.$queryRaw<{ minutes: number }[]>`
        SELECT EXTRACT(EPOCH FROM (MIN(o."createdAt") - j."createdAt")) / 60 AS minutes
        FROM "JobRequest" j JOIN "Offer" o ON o."jobRequestId" = j.id
        WHERE j."createdAt" >= ${from} AND j."createdAt" < ${to}
        GROUP BY j.id`,
    ]);
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      users: Object.fromEntries(usersByType.map((r) => [r.type, r._count])),
      workersOnline: onlineWorkers,
      jobsNow: Object.fromEntries(jobsByStatus.map((r) => [r.status, r._count])),
      requests: created,
      booked,
      /** Requests in the range that got booked. */
      fillRate: created ? Math.round((booked / created) * 1000) / 10 : null,
      medianMinutesToFirstOffer: median(firstOffers.map((r) => Math.round(Number(r.minutes)))),
      cancellations: Object.fromEntries(cancels.map((r) => [r.cancelReason ?? 'UNKNOWN', r._count])),
      openDisputes,
      openIncidents,
      gmv: gmv.map((g) => ({ currency: g.currency, amount: g._sum.amount ?? 0, payments: g._count })),
      commissionOwed: { amount: owed._sum.ledgerBalance ?? 0, workers: owed._count },
      commissionSettled: Math.abs(settled._sum.amount ?? 0),
    };
  }

  // ── jobs ───────────────────────────────────────────────────
  async jobDetail(id: string) {
    const j = await this.prisma.jobRequest.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true } },
        assignedWorker: { select: { id: true, user: { select: { name: true } } } },
        category: { select: { name: true } },
        events: { orderBy: { createdAt: 'asc' }, select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, payload: true, createdAt: true } },
        payments: true,
        disputes: { select: { id: true, category: true, reason: true, status: true, createdAt: true } },
        incidents: { select: { id: true, type: true, kind: true, severity: true, status: true, createdAt: true } },
        changeOrders: { select: { id: true, revisedPrice: true, previousPrice: true, currency: true, status: true, createdAt: true } },
        sosDispatch: true,
        conversations: { select: { id: true } },
      },
    });
    if (!j) throw new NotFoundException('Job not found');
    const { idempotencyKey, conversations, ...rest } = j as any;
    return { ...rest, conversationId: conversations[0]?.id ?? null };
  }

  /** A job's chat, for disputes and safety. Reading it is audited. */
  async transcript(jobId: string, staffId: string) {
    const c = await this.prisma.conversation.findFirst({ where: { jobRequestId: jobId }, select: { id: true, participants: { select: { id: true, name: true, type: true } } } });
    if (!c) throw new NotFoundException('No chat for this job');
    const messages = await this.prisma.message.findMany({
      where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, take: 1000,
      select: { id: true, senderId: true, text: true, imageKey: true, isSystem: true, isFlagged: true, createdAt: true },
    });
    await this.audit.record({ actorId: staffId, action: 'chat.transcript_viewed', entityType: 'JobRequest', entityId: jobId });
    return {
      participants: c.participants,
      messages: await Promise.all(messages.map(async ({ imageKey, ...m }) => ({ ...m, imageUrl: imageKey ? await this.storage.signedUrlForKey(imageKey, 300) : null }))),
    };
  }

  async cancelJob(id: string, staffId: string, reason: string) {
    const out = await this.jobs.cancel(id, admin(staffId), { reason: 'OTHER', note: reason });
    await this.audit.record({ actorId: staffId, action: 'job.cancelled', entityType: 'JobRequest', entityId: id, after: { reason } });
    return out;
  }

  async reassignJob(id: string, staffId: string, reason: string) {
    const before = await this.prisma.jobRequest.findUnique({ where: { id }, select: { assignedWorkerId: true, status: true } });
    if (!before) throw new NotFoundException('Job not found');
    const out = await this.jobs.reassign(id, admin(staffId), reason);
    await this.audit.record({ actorId: staffId, action: 'job.reassigned', entityType: 'JobRequest', entityId: id, before, after: { reason } });
    return out;
  }

  // ── users & staff ──────────────────────────────────────────
  /** Suspend (signed out everywhere), then release their open jobs; live bookings are flagged for Ops. */
  async suspendUser(id: string, staffId: string, reason: string) {
    const out = await this.users.suspendUser(id, staffId, reason);
    const released = await this.jobs.releaseSuspended(id, admin(staffId));
    if (released.cancelled.length || released.offersWithdrawn || released.activeBookings.length) {
      await this.audit.record({ actorId: staffId, action: 'user.suspension_jobs_released', entityType: 'User', entityId: id, after: { cancelled: released.cancelled, offersWithdrawn: released.offersWithdrawn, activeBookings: released.activeBookings.map((j) => j.id) } });
    }
    return { ...out, ...released };
  }

  async reactivateUser(id: string, staffId: string, reason: string) {
    const r = await this.prisma.user.updateMany({ where: { id, status: 'SUSPENDED' }, data: { status: 'ACTIVE', failedLoginAttempts: 0, lockoutUntil: null } });
    if (!r.count) throw new ConflictException({ code: 'NOT_SUSPENDED', message: 'This account is not suspended.' });
    await this.audit.record({ actorId: staffId, action: 'user.reactivated', entityType: 'User', entityId: id, before: { status: 'SUSPENDED' }, after: { status: 'ACTIVE', reason } });
    return { id, status: 'ACTIVE' };
  }

  async createStaff(staffId: string, dto: CreateStaffDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'That email already has an account.' });
    const password = randomBytes(12).toString('base64url');
    const u = await this.prisma.user.create({ data: { email, name: dto.name.trim(), type: 'admin', adminRoles: [...new Set(dto.roles)], password: await bcrypt.hash(password, 12) } });
    await this.audit.record({ actorId: staffId, action: 'staff.created', entityType: 'User', entityId: u.id, after: { email, roles: u.adminRoles } });
    // Shown once to the person who created the account; they share it privately.
    return { id: u.id, email, roles: u.adminRoles, temporaryPassword: password };
  }

  async auditLogs(q: AuditQuery) {
    const take = 50;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.actorId ? { actorId: q.actorId } : {}), ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return page(rows, take);
  }

  // ── safety ─────────────────────────────────────────────────
  async incidents(q: IncidentListQuery) {
    const take = 50;
    const rows = await this.prisma.incident.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) },
      include: { reporter: { select: { id: true, name: true, type: true } }, jobRequest: { select: { id: true, title: true, status: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return page(rows.map(({ idempotencyKey, ...r }) => r) as any, take);
  }

  async incident(id: string) {
    const i = await this.prisma.incident.findUnique({
      where: { id },
      include: { reporter: { select: { id: true, name: true, type: true } }, jobRequest: { select: { id: true, title: true, status: true } }, notes: { orderBy: { createdAt: 'asc' } } },
    });
    if (!i) throw new NotFoundException('Incident not found');
    const target = i.targetId ? await this.prisma.user.findUnique({ where: { id: i.targetId }, select: { id: true, name: true, type: true, status: true } }) : null;
    const { idempotencyKey, ...rest } = i;
    return { ...rest, target };
  }

  async updateIncident(id: string, staffId: string, dto: IncidentUpdateDto) {
    const before = await this.prisma.incident.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new NotFoundException('Incident not found');
    if (!dto.status && !dto.note) throw new BadRequestException({ code: 'NOTHING_TO_SAVE', message: 'Change the status or add a note.' });
    await this.prisma.$transaction(async (tx) => {
      if (dto.status && dto.status !== before.status) await tx.incident.update({ where: { id }, data: { status: dto.status } });
      if (dto.note) await tx.incidentNote.create({ data: { incidentId: id, authorId: staffId, text: dto.note.trim() } });
    });
    await this.audit.record({ actorId: staffId, action: 'incident.updated', entityType: 'Incident', entityId: id, before, after: { status: dto.status ?? before.status, note: !!dto.note } });
    return this.incident(id);
  }

  // ── finance ────────────────────────────────────────────────
  async payments(q: PaymentQuery) {
    const take = 50;
    const rows = await this.prisma.payment.findMany({
      where: q.status ? { status: q.status } : {},
      include: { jobRequest: { select: { id: true, title: true, customer: { select: { name: true } }, assignedWorker: { select: { user: { select: { name: true } } } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return page(rows, take);
  }

  balances() {
    return this.prisma.worker.findMany({
      where: { ledgerBalance: { gt: 0 } },
      select: { id: true, ledgerBalance: true, owedSince: true, balanceBlocked: true, currency: true, user: { select: { name: true } } },
      orderBy: { ledgerBalance: 'desc' },
      take: 200,
    });
  }

  workerLedger(workerId: string) {
    return this.prisma.ledgerEntry.findMany({ where: { workerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
  }

  async adjust(workerId: string, staffId: string, dto: AdjustmentDto) {
    const w = await this.prisma.worker.findUnique({ where: { id: workerId }, select: { currency: true } });
    if (!w) throw new NotFoundException('Worker not found');
    const country = await this.countries.forWorker(workerId);
    const r = await this.prisma.$transaction((tx) => this.ledger.post(tx, {
      workerId, type: 'ADJUSTMENT', amount: dto.amount, currency: country.currency,
      idempotencyKey: `adjust:${dto.idempotencyKey}`, createdById: staffId, note: dto.note.trim(),
    }));
    if (!r.duplicate) await this.audit.record({ actorId: staffId, action: 'ledger.adjusted', entityType: 'Worker', entityId: workerId, after: { amount: dto.amount, note: dto.note } });
    if (r.becameBlocked) await this.ledger.notifyPaused(workerId, r.entry.id);
    return r.entry;
  }

  async disputeDetail(id: string) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: { raisedBy: { select: { id: true, name: true, type: true } }, jobRequest: { select: { id: true, title: true, status: true, agreedAmount: true, agreedCurrency: true, customerId: true, assignedWorkerId: true } } },
    });
    if (!d) throw new NotFoundException('Dispute not found');
    const { evidenceKeys, ...rest } = d;
    const payment = d.paymentId ? await this.prisma.payment.findUnique({ where: { id: d.paymentId } }) : null;
    return { ...rest, payment, evidence: await Promise.all(evidenceKeys.map((k) => this.storage.signedUrlForKey(k, 300))) };
  }

  // ── reviews ────────────────────────────────────────────────
  async reviewQueue(hidden = false) {
    return this.prisma.review.findMany({
      where: hidden ? { status: 'HIDDEN' } : { status: 'PUBLISHED', OR: [{ flagged: true }, { reports: { some: {} } }] },
      include: { reviewer: { select: { id: true, name: true } }, target: { select: { id: true, name: true } }, reports: { select: { reason: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async moderateReview(id: string, staffId: string, dto: ModerateReviewDto) {
    const r = await this.prisma.review.findUnique({ where: { id }, select: { status: true, targetId: true, revieweeRole: true } });
    if (!r) throw new NotFoundException('Review not found');
    await this.prisma.$transaction(async (tx) => {
      if (dto.action === 'HIDE') await tx.review.update({ where: { id }, data: { status: 'HIDDEN', flagged: false } });
      if (dto.action === 'RESTORE') await tx.review.update({ where: { id }, data: { status: 'PUBLISHED', flagged: false } });
      if (dto.action === 'DISMISS') { await tx.review.update({ where: { id }, data: { flagged: false } }); await tx.reviewReport.deleteMany({ where: { reviewId: id } }); }
      if (r.revieweeRole === 'worker' && dto.action !== 'DISMISS') {
        // A worker's rating counts published reviews only.
        const agg = await tx.review.aggregate({ where: { targetId: r.targetId, status: 'PUBLISHED', revieweeRole: 'worker' }, _avg: { rating: true } });
        await tx.worker.update({ where: { id: r.targetId }, data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10 } });
      }
    });
    await this.audit.record({ actorId: staffId, action: `review.${dto.action.toLowerCase()}`, entityType: 'Review', entityId: id, before: { status: r.status }, after: { note: dto.note } });
    return { id, action: dto.action };
  }

  // ── catalogue & price bands ────────────────────────────────
  /** Everything, hidden items included, so staff can turn them back on. */
  catalog() {
    const order = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];
    return this.prisma.serviceCategory.findMany({ include: { services: { orderBy: order }, issues: { orderBy: order } }, orderBy: order });
  }

  async updateCategory(id: string, staffId: string, dto: UpdateCategoryContentDto) {
    const before = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    const translations = dto.translations ? { ...((before.translations as object) ?? {}), ...dto.translations } : undefined;
    const after = await this.prisma.serviceCategory.update({
      where: { id },
      data: { ...(translations ? { translations: translations as Prisma.InputJsonValue } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
    await this.audit.record({ actorId: staffId, action: 'catalog.category_updated', entityType: 'ServiceCategory', entityId: id, before: { translations: before.translations, isActive: before.isActive }, after: { translations: after.translations, isActive: after.isActive } });
    return after;
  }

  async upsertIssue(categoryId: string, staffId: string, dto: IssueDto) {
    if (!(await this.prisma.serviceCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) throw new NotFoundException('Category not found');
    const issue = await this.prisma.serviceIssue.upsert({
      where: { categoryId_code: { categoryId, code: dto.code } },
      create: { categoryId, code: dto.code, name: dto.name.trim(), translations: (dto.translations ?? {}) as Prisma.InputJsonValue, sortOrder: dto.sortOrder ?? 0, isActive: dto.isActive ?? true },
      update: { name: dto.name.trim(), ...(dto.translations ? { translations: dto.translations as Prisma.InputJsonValue } : {}), ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
    });
    await this.audit.record({ actorId: staffId, action: 'catalog.issue_saved', entityType: 'ServiceIssue', entityId: issue.id, after: { code: dto.code, name: dto.name, isActive: issue.isActive } });
    return issue;
  }

  priceBands(categoryId?: string) {
    return this.prisma.priceBand.findMany({ where: categoryId ? { categoryId } : {}, orderBy: [{ city: 'asc' }, { categoryId: 'asc' }] });
  }

  async savePriceBand(staffId: string, dto: PriceBandDto) {
    if (dto.minMinor > dto.maxMinor) throw new BadRequestException({ code: 'MIN_ABOVE_MAX', message: 'The lowest price must not be above the highest.' });
    const city = dto.city.trim();
    const issueCode = dto.issueCode ?? null;
    const existing = await this.prisma.priceBand.findFirst({ where: { categoryId: dto.categoryId, issueCode, city } });
    const data = { categoryId: dto.categoryId, issueCode, city, currency: dto.currency, minMinor: dto.minMinor, maxMinor: dto.maxMinor, approved: dto.approved ?? false, updatedById: staffId };
    const band = existing ? await this.prisma.priceBand.update({ where: { id: existing.id }, data }) : await this.prisma.priceBand.create({ data });
    await this.audit.record({ actorId: staffId, action: 'catalog.price_band_saved', entityType: 'PriceBand', entityId: band.id, before: existing ?? undefined, after: data });
    return band;
  }

  // ── country settings & flags ───────────────────────────────
  async countryConfig(code: string) {
    const row = await this.prisma.countryConfig.findUnique({ where: { countryCode: code.toUpperCase() } });
    if (!row) throw new NotFoundException('Country not configured');
    const versions = await this.prisma.countryConfigVersion.findMany({ where: { countryCode: row.countryCode }, orderBy: { version: 'desc' }, take: 20, select: { version: true, editedById: true, createdAt: true } });
    return { ...row, versions };
  }

  async saveCountryConfig(code: string, staffId: string, dto: CountryConfigDto) {
    const countryCode = code.toUpperCase();
    if (dto.commission.minMinor > dto.commission.maxMinor) throw new BadRequestException({ code: 'COMMISSION_MIN_ABOVE_MAX', message: 'The minimum fee must not be above the maximum.' });
    if (dto.cashLimits.softMinor > dto.cashLimits.hardMinor) throw new BadRequestException({ code: 'SOFT_ABOVE_HARD', message: 'The warning level must not be above the pause level.' });
    if (!dto.emergencyNumbers.length) throw new BadRequestException({ code: 'NO_EMERGENCY_NUMBERS', message: 'Keep at least one emergency number.' });
    const data = { commission: dto.commission, cashLimits: dto.cashLimits, settlementRails: dto.settlementRails.map((r) => ({ ...r, account: r.account ?? null })), emergencyNumbers: dto.emergencyNumbers };
    const saved = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.countryConfig.findUnique({ where: { countryCode } });
      if (!cur) throw new NotFoundException('Country not configured');
      // Two staff editing at once: the second save is refused instead of silently overwriting.
      const r = await tx.countryConfig.updateMany({
        where: { countryCode, version: dto.baseVersion },
        data: { ...(data as any), version: { increment: 1 } },
      });
      if (!r.count) throw new ConflictException({ code: 'CONFIG_CHANGED', message: 'Someone saved these settings while you were editing. Reload and try again.' });
      const next = await tx.countryConfig.findUniqueOrThrow({ where: { countryCode } });
      // The version before this one is kept too, so any change can be looked up or rolled back.
      await tx.countryConfigVersion.upsert({
        where: { countryCode_version: { countryCode, version: cur.version } },
        create: { countryCode, version: cur.version, data: { commission: cur.commission, cashLimits: cur.cashLimits, settlementRails: cur.settlementRails, emergencyNumbers: cur.emergencyNumbers } as Prisma.InputJsonValue },
        update: {},
      });
      await tx.countryConfigVersion.create({ data: { countryCode, version: next.version, data: data as unknown as Prisma.InputJsonValue, editedById: staffId } });
      return { before: cur, after: next };
    });
    this.countries.invalidate();
    await this.audit.record({ actorId: staffId, action: 'config.country_saved', entityType: 'CountryConfig', entityId: countryCode, before: { version: saved.before.version, commission: saved.before.commission, cashLimits: saved.before.cashLimits }, after: { version: saved.after.version, ...data } as any });
    return saved.after;
  }

  flagsList() { return this.flags.list(); }

  async setFlag(key: string, staffId: string, value: boolean) {
    if (!(key in FLAGS)) throw new NotFoundException('Unknown flag');
    const before = await this.flags.get(key as FlagKey);
    await this.flags.set(key as FlagKey, value, staffId);
    await this.audit.record({ actorId: staffId, action: 'config.flag_set', entityType: 'FeatureFlag', entityId: key, before: { value: before }, after: { value } });
    return { key, value };
  }
}
