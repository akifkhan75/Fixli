import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../common/audit/audit.service';
import {
  CreatePortfolioDto, SetHoursDto, SetSkillsDto, SubmitVerificationDto, UpdateWorkerDto, WorkerQueryDto,
} from './dto/update-worker.dto';
import { computeOnboarding, latestCases } from './onboarding';

// What any signed-in user may see about a worker. Never email, phone, documents or exact base location.
const PUBLIC_WORKER_SELECT = {
  id: true,
  rating: true,
  bio: true,
  experienceYears: true,
  languages: true,
  hasInsurance: true,
  isVerified: true,
  isOnline: true,
  serviceRadius: true,
  serviceAreaLabel: true,
  currency: true,
  pricingModel: true,
  minimumCallOutFee: true,
  hourlyRate: true,
  hidePhotoUntilBooked: true,
  user: { select: { id: true, name: true, profileImageUrl: true } },
  services: { select: { category: { select: { id: true, name: true, translations: true } } } },
  portfolio: { select: { id: true, title: true, description: true, photoKeys: true }, orderBy: { createdAt: 'desc' as const }, take: 12 },
  verifications: {
    where: { status: 'APPROVED' as const },
    select: { type: true, reviewedAt: true, expiresAt: true },
  },
} satisfies Prisma.WorkerSelect;

const OWN_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true, profileImageUrl: true } },
  services: { select: { category: { select: { id: true, name: true, translations: true } } } },
  workingHours: { orderBy: { weekday: 'asc' as const } },
  portfolio: { orderBy: { createdAt: 'desc' as const } },
  verifications: { orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.WorkerInclude;

import { DomainEvents } from '../common/events/domain-events';

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // ── public ────────────────────────────────────────────────

  async findAll(filters?: WorkerQueryDto) {
    const where: Prisma.WorkerWhereInput = { activationStatus: 'ACTIVE' };
    if (filters?.skill) where.services = { some: { category: { name: filters.skill } } };
    if (filters?.minRating) where.rating = { gte: filters.minRating };
    const rows = await this.prisma.worker.findMany({
      where, select: PUBLIC_WORKER_SELECT, orderBy: { rating: 'desc' }, take: 50,
    });
    return Promise.all(rows.map((w) => this.toPublic(w, undefined)));
  }

  async findPublicById(id: string, viewer?: { id: string; type: string }) {
    const worker = await this.prisma.worker.findFirst({ where: { id, activationStatus: 'ACTIVE' }, select: PUBLIC_WORKER_SELECT });
    if (!worker) throw new NotFoundException('Worker not found');
    return this.toPublic(worker, viewer);
  }

  async findMatchingWorkers(jobType: string, limit = 3) {
    const rows = await this.prisma.worker.findMany({
      where: { activationStatus: 'ACTIVE', isOnline: true, services: { some: { category: { name: jobType } } } },
      select: PUBLIC_WORKER_SELECT, orderBy: { rating: 'desc' }, take: limit,
    });
    return Promise.all(rows.map((w) => this.toPublic(w, undefined)));
  }

  private async toPublic(
    w: Prisma.WorkerGetPayload<{ select: typeof PUBLIC_WORKER_SELECT }>,
    viewer?: { id: string; type: string },
  ) {
    const [ratingAgg, jobsCompleted, hasBooked] = await Promise.all([
      this.prisma.review.aggregate({ where: { targetId: w.id }, _count: true }),
      this.prisma.jobRequest.count({ where: { assignedWorkerId: w.id, status: 'COMPLETED' } }),
      // Photo may be hidden until the viewer has actually booked this worker.
      w.hidePhotoUntilBooked && viewer
        ? this.prisma.jobRequest.count({
            where: { customerId: viewer.id, assignedWorkerId: w.id, status: { in: ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'] } },
          })
        : Promise.resolve(0),
    ]);
    const showPhoto = !w.hidePhotoUntilBooked || hasBooked > 0 || viewer?.id === w.id || viewer?.type === 'admin';
    const { portfolio, verifications, user, ...rest } = w;
    return {
      ...rest,
      user: { ...user, profileImageUrl: showPhoto ? user.profileImageUrl : null },
      ratingCount: ratingAgg._count,
      jobsCompleted,
      portfolio: portfolio.map((p) => ({ id: p.id, title: p.title, description: p.description, photos: p.photoKeys.map((k) => this.storage.publicUrl(k)) })),
      // A badge is only shown for a check that was actually approved, with what it means and when.
      badges: verifications.map((v) => ({ type: v.type, verifiedAt: v.reviewedAt, expiresAt: v.expiresAt })),
    };
  }

  // ── own profile ───────────────────────────────────────────

  async findOwn(userId: string) {
    const w = await this.prisma.worker.findUnique({ where: { id: userId }, include: OWN_INCLUDE });
    if (!w) throw new NotFoundException('Worker not found');
    const cases = latestCases(w.verifications);
    const onboarding = computeOnboarding({
      skillCount: w.services.length,
      serviceLat: w.serviceLat, serviceLng: w.serviceLng, serviceRadius: w.serviceRadius,
      hoursDays: w.workingHours.length,
      pricingModel: w.pricingModel, minimumCallOutFee: w.minimumCallOutFee, hourlyRate: w.hourlyRate,
      cases,
    });
    const { verifications, portfolio, ...rest } = w;
    return {
      ...rest,
      portfolio: portfolio.map((p) => ({ id: p.id, title: p.title, description: p.description, photos: p.photoKeys.map((k) => this.storage.publicUrl(k)) })),
      // Own documents are never exposed as URLs here: ask /uploads/:id/url or the admin API.
      verifications: cases.map((c) => ({
        id: c.id, type: c.type, status: c.status, reason: c.reason, reviewedAt: c.reviewedAt, expiresAt: c.expiresAt, createdAt: c.createdAt,
      })),
      onboarding,
    };
  }

  async update(userId: string, dto: UpdateWorkerDto) {
    const worker = await this.prisma.worker.findUnique({ where: { id: userId }, select: { activationStatus: true, serviceLat: true, serviceLng: true } });
    if (!worker) throw new NotFoundException('Worker not found');

    if (dto.isOnline === true && worker.activationStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'WORKER_NOT_ACTIVE', message: 'You can go online once your documents are approved.' });
    }
    if ((dto.serviceLat != null) !== (dto.serviceLng != null) && (worker.serviceLat == null || worker.serviceLng == null)) {
      throw new BadRequestException('Send both latitude and longitude');
    }
    if (dto.pricingModel === 'HOURLY' && dto.hourlyRate === undefined) {
      const cur = await this.prisma.worker.findUnique({ where: { id: userId }, select: { hourlyRate: true } });
      if (!cur?.hourlyRate) throw new BadRequestException({ code: 'HOURLY_RATE_REQUIRED', message: 'Enter your hourly rate.' });
    }

    await this.prisma.worker.update({ where: { id: userId }, data: dto });
    return this.findOwn(userId);
  }

  async setSkills(userId: string, dto: SetSkillsDto) {
    const ids = [...new Set(dto.categoryIds)];
    const cats = await this.prisma.serviceCategory.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
    if (cats.length !== ids.length) throw new BadRequestException({ code: 'INVALID_CATEGORY', message: 'One of those skills is not available.' });
    await this.prisma.$transaction([
      this.prisma.workerService.deleteMany({ where: { workerId: userId } }),
      this.prisma.workerService.createMany({ data: ids.map((categoryId) => ({ workerId: userId, categoryId })) }),
    ]);
    return this.findOwn(userId);
  }

  async setHours(userId: string, dto: SetHoursDto) {
    const days = new Set(dto.days.map((d) => d.weekday));
    if (days.size !== dto.days.length) throw new BadRequestException('Each day can only appear once');
    for (const d of dto.days) {
      if (d.endMinute <= d.startMinute) throw new BadRequestException({ code: 'INVALID_HOURS', message: 'Finish time must be after start time.' });
    }
    await this.prisma.$transaction([
      this.prisma.workingHours.deleteMany({ where: { workerId: userId } }),
      this.prisma.workingHours.createMany({ data: dto.days.map((d) => ({ workerId: userId, ...d })) }),
    ]);
    return this.findOwn(userId);
  }

  async addPortfolio(userId: string, dto: CreatePortfolioDto) {
    if (dto.uploadIds.length < 1) throw new BadRequestException('Add at least one photo');
    const count = await this.prisma.portfolioItem.count({ where: { workerId: userId } });
    if (count >= 20) throw new ConflictException({ code: 'PORTFOLIO_FULL', message: 'You can show up to 20 projects.' });
    await this.prisma.$transaction(async (tx) => {
      const keys = await this.storage.consume(userId, dto.uploadIds, 'PORTFOLIO', tx);
      await tx.portfolioItem.create({ data: { workerId: userId, title: dto.title, description: dto.description, photoKeys: keys } });
    });
    return this.findOwn(userId);
  }

  async removePortfolio(userId: string, itemId: string) {
    const item = await this.prisma.portfolioItem.findFirst({ where: { id: itemId, workerId: userId } });
    if (!item) throw new NotFoundException('Project not found');
    await this.prisma.portfolioItem.delete({ where: { id: itemId } });
    return this.findOwn(userId);
  }

  async submitVerification(userId: string, dto: SubmitVerificationDto) {
    if (dto.uploadIds.length < 1) throw new BadRequestException('Add at least one photo');
    if (dto.type === 'ID' && dto.uploadIds.length < 2) {
      throw new BadRequestException({ code: 'ID_NEEDS_TWO_SIDES', message: 'Add photos of the front and back of your ID.' });
    }
    const worker = await this.prisma.worker.findUnique({ where: { id: userId }, select: { activationStatus: true } });
    if (!worker) throw new NotFoundException('Worker not found');
    if (['SUSPENDED', 'REJECTED'].includes(worker.activationStatus)) {
      throw new ForbiddenException('Your account cannot submit documents. Please contact support.');
    }
    const verificationCase = await this.prisma.$transaction(async (tx) => {
      const keys = await this.storage.consume(userId, dto.uploadIds, 'VERIFICATION', tx);
      return tx.verificationCase.create({ data: { workerId: userId, type: dto.type, documentKeys: keys, reference: dto.reference } });
    });
    // After commit, so staff never open a case that was rolled back.
    this.events.emit('admin.verification_submitted', { caseId: verificationCase.id, workerId: userId });
    await this.audit.record({ actorId: userId, action: 'verification.submitted', entityType: 'Worker', entityId: userId, after: { type: dto.type } });
    return this.findOwn(userId);
  }

  /** Worker says "I'm done": the profile is checked server-side before an admin ever sees it. */
  async submitForReview(userId: string) {
    const own = await this.findOwn(userId);
    if (!['ONBOARDING', 'REJECTED'].includes(own.activationStatus)) {
      throw new ConflictException({ code: 'ALREADY_SUBMITTED', message: 'Your profile is already with our team.' });
    }
    if (!own.onboarding.complete) {
      throw new BadRequestException({ code: 'PROFILE_INCOMPLETE', message: 'Please finish every step first.', details: own.onboarding.missing });
    }
    await this.prisma.worker.update({ where: { id: userId }, data: { activationStatus: 'PENDING_REVIEW' } });
    await this.audit.record({ actorId: userId, action: 'worker.submitted_for_review', entityType: 'Worker', entityId: userId });
    return this.findOwn(userId);
  }

  async getEarnings(userId: string) {
    // Return stats from LedgerEntry and payments
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [ledgerCount, recentEntries] = await Promise.all([
      this.prisma.ledgerEntry.count({ where: { workerId: userId } }),
      this.prisma.ledgerEntry.findMany({
        where: { workerId: userId, createdAt: { gte: today } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const lastLedger = await this.prisma.ledgerEntry.findFirst({
      where: { workerId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      currentBalance: lastLedger?.balanceAfter ?? 0,
      todayEarnings: recentEntries.filter(e => e.type === 'COMMISSION_OWED').reduce((acc, e) => acc + Math.abs(e.amount), 0),
      totalEntries: ledgerCount,
    };
  }

  async getLedger(userId: string, skip: number = 0, take: number = 50) {
    const [entries, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { workerId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.ledgerEntry.count({ where: { workerId: userId } }),
    ]);

    return { entries, total };
  }
}
