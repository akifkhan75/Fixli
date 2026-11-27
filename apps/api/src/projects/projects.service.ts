import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { COUNTRIES, isCountryCode, routes } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BlocksService } from '../blocks/blocks.service';
import { CARD_GATEWAY, CardGateway } from '../payments/card.gateway';
import { ProjectMatchingService } from './project-matching.service';
import { BLOCKS_CANCEL, currentMilestone } from './project-state';
import { AddMaterialDto, AddVisitDto, AwardDto, CreateProjectDto, SubmitBidDto, UpdateProjectDto } from './projects.dto';

const CATEGORY = { select: { id: true, name: true, iconName: true, translations: true } } as const;
const PAGE = 20;
const firstName = (name: string) => name.trim().split(/\s+/)[0];

type Viewer = { id: string; type: string };

/**
 * Larger work (a new house's wiring, a bathroom renovation): the customer describes it once,
 * professionals bid with a price, a duration and payment stages, and the chosen one works through
 * the stages. Money rules for stages are in MilestonesService.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly blocks: BlocksService,
    private readonly matching: ProjectMatchingService,
    @Inject(CARD_GATEWAY) private readonly cards: CardGateway,
  ) {}

  private checkBudget(min?: number | null, max?: number | null) {
    if (min != null && max != null && min > max) {
      throw new BadRequestException({ code: 'BUDGET_RANGE', message: 'The lowest budget cannot be more than the highest.' });
    }
  }

  async create(customerId: string, dto: CreateProjectDto) {
    const again = () => this.prisma.project.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: dto.idempotencyKey } }, select: { id: true } });
    const existing = await again();
    if (existing) return this.view({ id: customerId, type: 'customer' }, existing.id);

    this.checkBudget(dto.budgetMin, dto.budgetMax);
    const [user, category, address] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: customerId }, select: { countryCode: true } }),
      this.prisma.serviceCategory.findFirst({ where: { id: dto.categoryId, isActive: true }, select: { id: true } }),
      this.prisma.address.findFirst({ where: { id: dto.addressId, userId: customerId } }),
    ]);
    if (!category) throw new BadRequestException({ code: 'UNKNOWN_CATEGORY', message: 'Choose a kind of work from the list.' });
    if (!address) throw new BadRequestException({ code: 'UNKNOWN_ADDRESS', message: 'Choose one of your saved addresses.' });
    const description = dto.description?.trim() ?? '';
    if (!description && !dto.audioUploadId && !dto.photoUploadIds?.length) {
      throw new BadRequestException({ code: 'DESCRIBE_PROJECT', message: 'Tell us or show us what you need done.' });
    }
    const country = user.countryCode && isCountryCode(user.countryCode) ? user.countryCode : 'PK';

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const photoKeys = dto.photoUploadIds?.length ? await this.storage.consume(customerId, dto.photoUploadIds, 'JOB_PHOTO', tx) : [];
        const [audioKey] = dto.audioUploadId ? await this.storage.consume(customerId, [dto.audioUploadId], 'JOB_AUDIO', tx) : [];
        const created = await tx.project.create({
          data: {
            customerId, categoryId: category.id, title: dto.title.trim(), description,
            workType: dto.workType, propertyType: dto.propertyType ?? 'HOUSE',
            status: dto.draft ? 'DRAFT' : 'OPEN', publishedAt: dto.draft ? null : new Date(),
            addressId: address.id,
            location: [address.buildingDetail, address.streetAddress, address.area, address.city].filter(Boolean).join(', '),
            latitude: address.latitude, longitude: address.longitude, area: address.area, city: address.city,
            budgetMin: dto.budgetMin, budgetMax: dto.budgetMax, currency: COUNTRIES[country].currency.code,
            startWhen: dto.startWhen ?? 'ASAP',
            suggestedMilestones: dto.suggestedMilestones?.length ? (dto.suggestedMilestones.map(({ title, percent }) => ({ title, percent })) as Prisma.InputJsonValue) : undefined,
            photoKeys, audioKey, audioTranscript: audioKey ? dto.audioTranscript?.trim() || null : null,
            idempotencyKey: dto.idempotencyKey,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (e: any) {
      // The same send arriving twice at once: the other one created it.
      const raced = e?.code === 'P2002' || e?.response?.code === 'UPLOAD_IN_USE' || e?.response?.code === 'INVALID_UPLOAD' ? await again() : null;
      if (!raced) throw e;
      id = raced.id;
    }
    if (!dto.draft) await this.tellProfessionals(id);
    return this.view({ id: customerId, type: 'customer' }, id);
  }

  /** Matching must never make publishing fail: the sweeper tries again. */
  private async tellProfessionals(projectId: string) {
    await this.matching.invite(projectId).catch((e) => this.logger.error(`Invites for ${projectId} failed: ${(e as Error).message}`));
  }

  private async own(customerId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, customerId }, include: { _count: { select: { bids: { where: { status: 'PENDING' } } } } } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async update(customerId: string, id: string, dto: UpdateProjectDto) {
    const p = await this.own(customerId, id);
    this.checkBudget(dto.budgetMin ?? p.budgetMin, dto.budgetMax ?? p.budgetMax);
    const r = await this.prisma.project.updateMany({
      // Never change what someone has already priced.
      where: { id, customerId, OR: [{ status: 'DRAFT' }, { status: 'OPEN', bids: { none: { status: 'PENDING' } } }] },
      data: { title: dto.title?.trim(), description: dto.description?.trim(), budgetMin: dto.budgetMin, budgetMax: dto.budgetMax, startWhen: dto.startWhen },
    });
    if (!r.count) throw new ConflictException({ code: 'PROJECT_LOCKED', message: 'This project already has prices, so it can no longer be changed.' });
    return this.view({ id: customerId, type: 'customer' }, id);
  }

  async publish(customerId: string, id: string) {
    await this.own(customerId, id);
    const r = await this.prisma.project.updateMany({ where: { id, customerId, status: 'DRAFT' }, data: { status: 'OPEN', publishedAt: new Date() } });
    if (r.count) await this.tellProfessionals(id);
    return this.view({ id: customerId, type: 'customer' }, id);
  }

  /** The signed-in person's projects: ones they posted, or ones they were hired for. */
  async listMine(user: Viewer, cursor?: string) {
    const rows = await this.prisma.project.findMany({
      where: user.type === 'worker' ? { awardedWorkerId: user.id } : { customerId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, title: true, status: true, workType: true, area: true, city: true, currency: true, agreedAmount: true, budgetMin: true, budgetMax: true, createdAt: true,
        category: CATEGORY,
        milestones: { select: { position: true, status: true, title: true } },
        _count: { select: { bids: { where: { status: 'PENDING' } } } },
      },
    });
    const items = rows.slice(0, PAGE).map(({ milestones, _count, ...p }) => ({
      ...p,
      bidCount: user.type === 'worker' ? undefined : _count.bids,
      stages: { total: milestones.filter((m) => m.status !== 'CANCELLED').length, done: milestones.filter((m) => m.status === 'RELEASED').length },
      currentStage: currentMilestone(milestones) ?? null,
    }));
    return { items, nextCursor: rows.length > PAGE ? items[items.length - 1].id : null };
  }

  /** Open projects this professional was told about, newest first, with their own bid if any. */
  async feed(workerId: string) {
    const rows = await this.prisma.projectInvite.findMany({
      where: { workerId, declinedAt: null, project: { status: 'OPEN' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        distanceKm: true,
        project: {
          select: {
            id: true, title: true, description: true, workType: true, propertyType: true, area: true, city: true, budgetMin: true, budgetMax: true, currency: true, startWhen: true, createdAt: true,
            category: CATEGORY,
            bids: { where: { workerId }, select: { id: true, totalAmount: true, status: true } },
          },
        },
      },
    });
    return rows.map(({ project: { bids, ...p }, distanceKm }) => ({ ...p, distanceKm, myBid: bids[0] ?? null }));
  }

  /** What this person may see of a project. Before hiring, a professional never sees who or exactly where. */
  async view(user: Viewer, id: string) {
    const p = await this.prisma.project.findUnique({
      where: { id },
      include: {
        category: CATEGORY,
        customer: { select: { id: true, name: true } },
        awardedWorker: { select: { id: true, rating: true, isVerified: true, businessName: true, user: { select: { name: true, profileImageUrl: true } } } },
        milestones: { orderBy: { position: 'asc' }, include: { payments: { orderBy: { createdAt: 'desc' }, select: { id: true, method: true, status: true, amount: true, checkoutUrl: true, checkoutExpiresAt: true, paidAt: true, releasedAt: true, refundedAt: true } } } },
        materials: { orderBy: { createdAt: 'asc' } },
        visits: { orderBy: { scheduledAt: 'asc' } },
        reviews: { select: { id: true, reviewerId: true, rating: true } },
        invites: { where: { workerId: user.id }, select: { distanceKm: true } },
        bids: { where: user.type === 'worker' ? { workerId: user.id } : {}, select: { id: true, workerId: true, status: true } },
      },
    });
    const isCustomer = !!p && p.customerId === user.id;
    const isHired = !!p && p.awardedWorkerId === user.id;
    const isCandidate = !!p && user.type === 'worker' && (p.invites.length > 0 || p.bids.length > 0) && p.status !== 'DRAFT';
    if (!p || !(isCustomer || isHired || isCandidate)) throw new NotFoundException('Project not found');
    const inside = isCustomer || isHired;
    // A professional who wasn't chosen keeps only what they needed to price it.
    if (!inside && await this.blocks.between(user.id, p.customerId)) throw new NotFoundException('Project not found');

    const sign = (k: string) => this.storage.signedUrlForKey(k, 600);
    const { photoKeys, audioKey, idempotencyKey, cancelledById, customer, awardedWorker, milestones, materials, visits, reviews, invites, bids, latitude, longitude, location, addressId, ...rest } = p;
    return {
      ...rest,
      // Who was hired, at what price and who the customer is stay between those two.
      ...(inside ? {} : { customerId: undefined, awardedWorkerId: undefined, awardedBidId: undefined, agreedAmount: null, awardedAt: undefined, completedAt: undefined, cancelReason: null }),
      viewer: isCustomer ? 'customer' as const : isHired ? 'hired' as const : 'candidate' as const,
      customer: inside ? customer : { id: undefined, name: firstName(customer.name) },
      location: inside ? location : null,
      latitude: inside ? latitude : null,
      longitude: inside ? longitude : null,
      distanceKm: invites[0]?.distanceKm ?? null,
      // Pictures and the voice note are for pricing: once the project closes, outsiders lose them.
      photos: inside || p.status === 'OPEN' ? await Promise.all(photoKeys.map(sign)) : [],
      audioUrl: audioKey && (inside || p.status === 'OPEN') ? await sign(audioKey) : null,
      ...(inside || p.status === 'OPEN' ? {} : { description: '', audioTranscript: null }),
      awardedWorker: inside ? awardedWorker : null,
      cardAvailable: this.cards.configured,
      milestones: inside ? await Promise.all(milestones.map(async ({ evidenceKeys, payments, ...m }) => ({
        ...m,
        evidence: await Promise.all(evidenceKeys.map(sign)),
        // The pay link belongs to the customer alone.
        payments: payments.map(({ checkoutUrl, checkoutExpiresAt, ...pay }) => ({ ...pay, checkoutUrl: isCustomer && pay.status === 'PENDING' && checkoutExpiresAt && checkoutExpiresAt > new Date() ? checkoutUrl : null })),
      }))) : [],
      materials: inside ? materials : [],
      visits: inside ? visits : [],
      reviews: inside ? reviews : [],
      bidCount: isCustomer ? bids.filter((b) => b.status === 'PENDING').length : undefined,
      myBid: user.type === 'worker' ? await this.prisma.projectBid.findUnique({ where: { projectId_workerId: { projectId: id, workerId: user.id } } }) : null,
    };
  }

  // ── Bids ───────────────────────────────────────────────────

  private async requireOpenInvite(workerId: string, projectId: string) {
    const [worker, invite] = await Promise.all([
      this.prisma.worker.findUnique({ where: { id: workerId }, select: { activationStatus: true, currency: true, balanceBlocked: true, user: { select: { name: true } } } }),
      this.prisma.projectInvite.findUnique({ where: { projectId_workerId: { projectId, workerId } }, include: { project: { select: { id: true, status: true, customerId: true, currency: true, title: true } } } }),
    ]);
    if (!invite) throw new NotFoundException('Project not found');
    if (worker?.activationStatus !== 'ACTIVE') throw new ForbiddenException({ code: 'WORKER_NOT_ACTIVE', message: 'Your account must be approved to send prices.' });
    if (await this.blocks.between(workerId, invite.project.customerId)) throw new NotFoundException('Project not found');
    if (worker.balanceBlocked) throw new ForbiddenException({ code: 'COMMISSION_LIMIT', message: 'Settle what you owe Fixli to send new prices.' });
    if (invite.project.status !== 'OPEN') throw new ConflictException({ code: 'PROJECT_CLOSED', message: 'This project is no longer open.' });
    return { project: invite.project, name: worker.user.name };
  }

  async submitBid(workerId: string, projectId: string, dto: SubmitBidDto) {
    const { project, name } = await this.requireOpenInvite(workerId, projectId);
    const milestones = (dto.milestones?.length ? dto.milestones : [{ title: project.title.slice(0, 80), amount: dto.totalAmount }])
      .map((m) => ({ title: m.title.trim(), amount: m.amount }));
    if (milestones.reduce((s, m) => s + m.amount, 0) !== dto.totalAmount) {
      throw new BadRequestException({ code: 'STAGES_DONT_ADD_UP', message: 'The stages must add up to your total price.' });
    }
    const data = {
      totalAmount: dto.totalAmount, currency: project.currency, durationDays: dto.durationDays, note: dto.note?.trim() || null,
      milestones: milestones as Prisma.InputJsonValue, status: 'PENDING' as const,
    };
    const bid = await this.prisma.projectBid.upsert({
      where: { projectId_workerId: { projectId, workerId } },
      create: { ...data, projectId, workerId },
      update: data,
    });
    await this.prisma.projectInvite.updateMany({ where: { projectId, workerId }, data: { declinedAt: null } });
    this.realtime.emitToUsers([project.customerId], 'project.updated', { projectId });
    await this.notifications.notify({
      type: 'project.bid', userIds: [project.customerId], eventKey: `project.bid:${bid.id}:${bid.updatedAt.getTime()}`,
      params: { worker: name, title: project.title, price: { minor: bid.totalAmount, currency: bid.currency } },
      data: { url: routes.customerProject(projectId), projectId },
    });
    return bid;
  }

  async withdrawBid(workerId: string, projectId: string) {
    const r = await this.prisma.projectBid.updateMany({ where: { projectId, workerId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    if (!r.count) throw new NotFoundException('You have no open price on this project');
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { customerId: true } });
    if (p) this.realtime.emitToUsers([p.customerId], 'project.updated', { projectId });
    return { success: true };
  }

  async notInterested(workerId: string, projectId: string) {
    const r = await this.prisma.projectInvite.updateMany({ where: { projectId, workerId }, data: { declinedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Project not found');
    await this.prisma.projectBid.updateMany({ where: { projectId, workerId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    return { success: true };
  }

  async listBids(customerId: string, projectId: string) {
    await this.own(customerId, projectId);
    const bids = await this.prisma.projectBid.findMany({
      where: {
        projectId, status: { in: ['PENDING', 'ACCEPTED'] },
        worker: { user: { status: 'ACTIVE', blocksCreated: { none: { blockedId: customerId } }, blockedBy: { none: { blockerId: customerId } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: PROJECT_BIDS_SHOWN,
      include: {
        worker: {
          select: {
            id: true, rating: true, isVerified: true, experienceYears: true, hidePhotoUntilBooked: true, businessName: true, teamSize: true,
            user: { select: { name: true, profileImageUrl: true } },
            projectBids: { where: { projectId }, select: { id: true } },
            _count: { select: { assignedJobs: { where: { status: 'COMPLETED' } }, projects: { where: { status: 'COMPLETED' } } } },
          },
        },
      },
    });
    const ids = bids.map((b) => b.workerId);
    const [reviews, distances] = await Promise.all([
      this.prisma.review.groupBy({ by: ['targetId'], where: { targetId: { in: ids } }, _count: true }),
      this.prisma.projectInvite.findMany({ where: { projectId, workerId: { in: ids } }, select: { workerId: true, distanceKm: true } }),
    ]);
    return bids.map(({ worker: w, ...b }) => ({
      id: b.id, totalAmount: b.totalAmount, currency: b.currency, durationDays: b.durationDays, note: b.note, milestones: b.milestones, status: b.status, createdAt: b.createdAt,
      worker: {
        id: w.id, name: w.user.name, businessName: w.businessName, teamSize: w.teamSize,
        profileImageUrl: w.hidePhotoUntilBooked && b.status !== 'ACCEPTED' ? null : w.user.profileImageUrl,
        rating: w.rating, ratingCount: reviews.find((r) => r.targetId === w.id)?._count ?? 0,
        jobsCompleted: w._count.assignedJobs + w._count.projects, isVerified: w.isVerified, experienceYears: w.experienceYears,
        distanceKm: distances.find((d) => d.workerId === w.id)?.distanceKm ?? null,
      },
    }));
  }

  /** Hire: atomic, so two taps (or two devices) can never hire two professionals. */
  async award(customerId: string, projectId: string, dto: AwardDto) {
    const project = await this.own(customerId, projectId);
    const bid = await this.prisma.projectBid.findFirst({ where: { id: dto.bidId, projectId } });
    if (!bid) throw new NotFoundException('Price not found');
    if (project.awardedBidId === bid.id) return this.view({ id: customerId, type: 'customer' }, projectId);
    if (await this.blocks.between(customerId, bid.workerId)) throw new ConflictException({ code: 'BLOCKED', message: 'You blocked this professional.' });
    if (dto.paymentMode === 'ESCROW' && !this.cards.configured) {
      throw new BadRequestException({ code: 'CARD_UNAVAILABLE', message: 'Card payments are not available yet. Choose to pay the professional directly.' });
    }
    const stages = bid.milestones as { title: string; amount: number }[];

    const losers = await this.prisma.$transaction(async (tx) => {
      const won = await tx.project.updateMany({
        where: { id: projectId, customerId, status: 'OPEN' },
        data: { status: 'AWARDED', awardedWorkerId: bid.workerId, awardedBidId: bid.id, agreedAmount: bid.totalAmount, paymentMode: dto.paymentMode, awardedAt: new Date() },
      });
      if (!won.count) throw new ConflictException({ code: 'PROJECT_CLOSED', message: 'This project is no longer open. Please refresh.' });
      // The price must still be the one the customer saw.
      const accepted = await tx.projectBid.updateMany({ where: { id: bid.id, status: 'PENDING', updatedAt: bid.updatedAt }, data: { status: 'ACCEPTED' } });
      if (!accepted.count) throw new ConflictException({ code: 'BID_CHANGED', message: 'This price just changed. Please look again.' });
      await tx.projectMilestone.createMany({ data: stages.map((s, position) => ({ projectId, position, title: s.title, amount: s.amount })) });
      const others = await tx.projectBid.findMany({ where: { projectId, id: { not: bid.id }, status: 'PENDING' }, select: { id: true, workerId: true } });
      await tx.projectBid.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'REJECTED' } });
      await tx.conversation.create({ data: { projectId, participants: { connect: [{ id: customerId }, { id: bid.workerId }] } } });
      return others;
    });

    await this.notifications.notify({
      type: 'project.awarded', userIds: [bid.workerId], eventKey: `project.awarded:${bid.id}`,
      params: { title: project.title }, data: { url: routes.workerProject(projectId), projectId },
    });
    await Promise.all(losers.map((l) => this.notifications.notify({
      type: 'project.not_chosen', userIds: [l.workerId], eventKey: `project.not_chosen:${l.id}`,
      params: { title: project.title }, data: { url: routes.workerJobs(), projectId }, push: false,
    })));
    this.realtime.emitToUsers([customerId, bid.workerId, ...losers.map((l) => l.workerId)], 'project.updated', { projectId });
    return this.view({ id: customerId, type: 'customer' }, projectId);
  }

  /**
   * Stop a project. Never while work or a payment is mid-flight (report a problem instead). Money
   * already held for stages not started is marked for refund; the sweeper sends it back.
   */
  async cancel(user: Viewer, projectId: string, reason?: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, OR: [{ customerId: user.id }, { awardedWorkerId: user.id }] },
      include: { milestones: { select: { id: true, status: true } } },
    });
    if (!p) throw new NotFoundException('Project not found');
    if (p.status === 'CANCELLED') return { success: true };
    if (p.status === 'COMPLETED') throw new ConflictException({ code: 'PROJECT_DONE', message: 'This project is already finished.' });
    // A professional may step back only before starting.
    if (p.customerId !== user.id && p.status !== 'AWARDED') {
      throw new ForbiddenException({ code: 'CANNOT_CANCEL', message: 'Work has started. Report a problem if you cannot continue.' });
    }
    const mid = () => new ConflictException({ code: 'STAGE_IN_PROGRESS', message: 'A stage is being worked on or paid. Finish it or report a problem first.' });
    if (p.milestones.some((m) => BLOCKS_CANCEL.includes(m.status))) throw mid();

    await this.prisma.$transaction(async (tx) => {
      const r = await tx.project.updateMany({
        where: { id: projectId, status: p.status, milestones: { none: { status: { in: BLOCKS_CANCEL } } } },
        data: { status: 'CANCELLED', cancelReason: reason?.trim() || null, cancelledById: user.id },
      });
      if (!r.count) throw mid();
      await tx.projectMilestone.updateMany({ where: { projectId, status: { in: ['PENDING', 'FUNDED'] } }, data: { status: 'CANCELLED' } });
      await tx.projectPayment.updateMany({ where: { milestone: { projectId }, status: 'HELD' }, data: { status: 'REFUND_PENDING' } });
      await tx.projectBid.updateMany({ where: { projectId, status: 'PENDING' }, data: { status: 'REJECTED' } });
    });
    const others = [p.customerId, p.awardedWorkerId].filter((x): x is string => !!x && x !== user.id);
    await Promise.all(others.map((o) => this.notifications.notify({
      type: 'project.cancelled', userIds: [o], eventKey: `project.cancelled:${projectId}`,
      params: { title: p.title }, data: { url: o === p.customerId ? routes.customerProject(projectId) : routes.workerProject(projectId), projectId },
    })));
    this.realtime.emitToUsers([p.customerId, p.awardedWorkerId ?? ''], 'project.updated', { projectId });
    return { success: true };
  }

  // ── Materials and visits ───────────────────────────────────

  /** The customer, or the professional they hired. */
  private async participant(userId: string, projectId: string) {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, OR: [{ customerId: userId }, { awardedWorkerId: userId }] },
      select: { id: true, status: true, customerId: true, awardedWorkerId: true, title: true },
    });
    if (!p) throw new NotFoundException('Project not found');
    if (p.status === 'CANCELLED' || p.status === 'COMPLETED') throw new ConflictException({ code: 'PROJECT_CLOSED', message: 'This project is closed.' });
    return p;
  }

  async addMaterial(userId: string, projectId: string, dto: AddMaterialDto) {
    const p = await this.participant(userId, projectId);
    if (await this.prisma.projectMaterial.count({ where: { projectId } }) >= 100) throw new BadRequestException({ code: 'TOO_MANY', message: 'The materials list is full.' });
    const row = await this.prisma.projectMaterial.create({ data: { projectId, name: dto.name.trim(), quantity: dto.quantity, unit: dto.unit?.trim() || null, providedBy: dto.providedBy, addedById: userId } });
    this.realtime.emitToUsers([p.customerId, p.awardedWorkerId ?? ''], 'project.updated', { projectId });
    return row;
  }

  async setMaterialReady(userId: string, projectId: string, materialId: string, isReady: boolean) {
    const p = await this.participant(userId, projectId);
    const r = await this.prisma.projectMaterial.updateMany({ where: { id: materialId, projectId }, data: { isReady } });
    if (!r.count) throw new NotFoundException('Material not found');
    this.realtime.emitToUsers([p.customerId, p.awardedWorkerId ?? ''], 'project.updated', { projectId });
    return { success: true };
  }

  async removeMaterial(userId: string, projectId: string, materialId: string) {
    const p = await this.participant(userId, projectId);
    // Only the person who added a line may remove it.
    const r = await this.prisma.projectMaterial.deleteMany({ where: { id: materialId, projectId, addedById: userId } });
    if (!r.count) throw new NotFoundException('Material not found');
    this.realtime.emitToUsers([p.customerId, p.awardedWorkerId ?? ''], 'project.updated', { projectId });
    return { success: true };
  }

  async addVisit(userId: string, projectId: string, dto: AddVisitDto) {
    const p = await this.participant(userId, projectId);
    if (!p.awardedWorkerId) throw new ConflictException({ code: 'NOT_HIRED', message: 'Choose a professional first.' });
    const at = new Date(dto.scheduledAt);
    if (at.getTime() < Date.now() - 3_600_000) throw new BadRequestException({ code: 'PAST_DATE', message: 'Choose a time in the future.' });
    const visit = await this.prisma.projectVisit.create({ data: { projectId, scheduledAt: at, note: dto.note?.trim() || null, createdById: userId } });
    const other = userId === p.customerId ? p.awardedWorkerId : p.customerId;
    await this.notifications.notify({
      type: 'project.visit', userIds: [other], eventKey: `project.visit:${visit.id}`,
      params: { title: p.title, date: at.toISOString().slice(0, 10) },
      data: { url: other === p.customerId ? routes.customerProject(projectId) : routes.workerProject(projectId), projectId },
    });
    this.realtime.emitToUsers([p.customerId, p.awardedWorkerId], 'project.updated', { projectId });
    return visit;
  }

  async updateVisit(userId: string, projectId: string, visitId: string, status: 'DONE' | 'CANCELLED') {
    const p = await this.participant(userId, projectId);
    const r = await this.prisma.projectVisit.updateMany({ where: { id: visitId, projectId, status: 'PLANNED' }, data: { status } });
    if (!r.count) throw new NotFoundException('Visit not found');
    this.realtime.emitToUsers([p.customerId, p.awardedWorkerId ?? ''], 'project.updated', { projectId });
    return { success: true };
  }
}

const PROJECT_BIDS_SHOWN = 40;
