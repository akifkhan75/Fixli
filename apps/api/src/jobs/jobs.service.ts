import { routes } from '@fixli/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { COUNTRIES, isCountryCode } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { JobStepPhotosDto } from './dto/job-step.dto';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit/audit.service';
import { LiveLocationService } from '../tracking/live-location.service';
import { BlocksService } from '../blocks/blocks.service';
import { DomainEvents } from '../common/events/domain-events';
import { systemMessage, SystemMessageKey } from '../chat/system-messages';
import { StaffAccessService } from '../common/access/staff-access.service';
import { NotificationType } from '../notifications/templates';
import { StorageService } from '../storage/storage.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobQueryDto } from './dto/job-query.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { assertTransition, BUSY_STATUSES, canTransition, CONTACT_STATUSES, JobActor, JobStatus, LATE_CANCEL_STATUSES } from './job-state-machine';
import { computeWindow, ScheduleError } from './schedule';
import { MatchingService } from '../matching/matching.service';
import { Logger } from '@nestjs/common';

export interface AuthUser {
  id: string;
  type: 'customer' | 'worker' | 'admin';
}

const BASE_INCLUDE = {
  category: { select: { id: true, name: true, iconName: true, translations: true } },
  customer: { select: { id: true, name: true } },
  assignedWorker: {
    select: {
      id: true, rating: true, isVerified: true,
      user: { select: { id: true, name: true, profileImageUrl: true } },
    },
  },
} satisfies Prisma.JobRequestInclude;

const DETAIL_INCLUDE = {
  ...BASE_INCLUDE,
  media: { select: { id: true, kind: true, storageKey: true, mime: true, transcript: true, createdAt: true }, orderBy: { createdAt: 'asc' as const } },
  events: { select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, payload: true, createdAt: true }, orderBy: { createdAt: 'asc' as const } },
  payments: { select: { id: true, method: true, amount: true, currency: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' as const } },
  reviews: { select: { id: true, rating: true, comment: true, reviewerId: true } },
  _count: { select: { matches: true } },
} satisfies Prisma.JobRequestInclude;

type JobRow = Prisma.JobRequestGetPayload<{ include: typeof BASE_INCLUDE }> & Partial<Prisma.JobRequestGetPayload<{ include: typeof DETAIL_INCLUDE }>>;

const BOOKED = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];

/** Job steps that also appear as a line in the job's chat. */
const SYSTEM_MESSAGE_FOR: Record<string, SystemMessageKey> = {
  EN_ROUTE: 'job.en_route',
  ARRIVED: 'job.arrived',
  WORK_STARTED: 'job.started',
  WORK_FINISHED: 'job.finished',
  WORK_COMPLETED: 'job.confirmed',
  AUTO_CONFIRMED: 'job.auto_confirmed',
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
    private readonly staff: StaffAccessService,
    private readonly storage: StorageService,
    private readonly matching: MatchingService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly location: LiveLocationService,
    private readonly blocks: BlocksService,
    private readonly events: DomainEvents,
  ) {}

  private readonly logger = new Logger(JobsService.name);

  /** Rows this user may see at all. Every read and write goes through this. */
  private visibleTo(user: AuthUser): Prisma.JobRequestWhereInput {
    if (user.type === 'admin') return {};
    if (user.type === 'customer') return { customerId: user.id };
    // Workers see jobs assigned to them, and open requests the matching engine sent them.
    return {
      OR: [
        { assignedWorkerId: user.id },
        { assignedWorkerId: null, status: 'MATCHES_FOUND', matches: { some: { workerId: user.id, declinedAt: null } } },
      ],
    };
  }

  /**
   * What each viewer is allowed to see. Workers get the area and city only, never the exact
   * address or coordinates, until they are booked on the job (doc 05 §6, doc 22 §5.4).
   * Media comes back as short-lived signed links, never storage keys.
   */
  private async present(job: JobRow, user: AuthUser) {
    const { idempotencyKey, cancelledById, media, events, customer, ...rest } = job as any;
    const isWorker = user.type === 'worker';
    const booked = job.assignedWorkerId === user.id && BOOKED.includes(job.status);
    const hideExact = isWorker && !booked;

    const out: Record<string, unknown> = {
      ...rest,
      customer: customer ? { id: customer.id, name: isWorker ? String(customer.name).split(' ')[0] : customer.name } : undefined,
    };
    delete out.customerName;
    if (hideExact) {
      delete out.location;
      delete out.latitude;
      delete out.longitude;
      delete out.addressId;
    }
    if (media) {
      out.media = await Promise.all(
        (media as any[]).map(async (m) => ({
          id: m.id, kind: m.kind, mime: m.mime, transcript: m.transcript, createdAt: m.createdAt,
          url: await this.storage.signedUrlForKey(m.storageKey, 600),
        })),
      );
    }
    if (events) out.events = events;
    if ((job as any).payments) out.payments = (job as any).payments;
    if ((job as any).reviews) out.reviews = (job as any).reviews;
    const counts = (job as any)._count;
    delete out._count;
    if (counts && !isWorker) out.notifiedCount = counts.matches;
    if (isWorker && job.status === 'MATCHES_FOUND') {
      out.myOffer = await this.prisma.offer.findUnique({
        where: { jobRequestId_workerId: { jobRequestId: job.id, workerId: user.id } },
        select: { id: true, amount: true, currency: true, etaMinutes: true, status: true, expiresAt: true },
      });
    }
    return out;
  }

  // ── create ────────────────────────────────────────────────

  /** `skipMatching`: SOS dispatch offers the job to the nearest worker itself, then falls back to matching. */
  async create(user: AuthUser, dto: CreateJobDto, opts: { skipMatching?: boolean } = {}) {
    if (user.type !== 'customer') throw new ForbiddenException('Only customers can request a service');

    // Same request sent twice (retry, double tap, flaky network) -> the same job.
    const existing = await this.prisma.jobRequest.findUnique({
      where: { customerId_idempotencyKey: { customerId: user.id, idempotencyKey: dto.idempotencyKey } },
      include: BASE_INCLUDE,
    });
    if (existing) return this.findById(existing.id, user);

    const [customer, category, address] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true, countryCode: true } }),
      this.prisma.serviceCategory.findFirst({ where: { id: dto.categoryId, isActive: true }, include: { issues: { where: { isActive: true } } } }),
      this.prisma.address.findFirst({ where: { id: dto.addressId, userId: user.id } }),
    ]);
    if (!category) throw new BadRequestException({ code: 'INVALID_CATEGORY', message: 'Please choose a service.' });
    if (!address) throw new BadRequestException({ code: 'INVALID_ADDRESS', message: 'Please choose one of your saved addresses.' });

    const issueCodes = [...new Set(dto.issueCodes ?? [])];
    const issues = category.issues.filter((i) => issueCodes.includes(i.code));
    if (issues.length !== issueCodes.length) throw new BadRequestException({ code: 'INVALID_ISSUE', message: 'One of the problems you chose is not available.' });

    const typed = dto.description?.trim() ?? '';
    const transcript = dto.audioTranscript?.trim() ?? '';
    if (typed.length < 3 && !transcript && issues.length === 0 && !dto.audioUploadId) {
      throw new BadRequestException({ code: 'DESCRIBE_PROBLEM', message: 'Tell us what is wrong: tap a problem, record a voice note, or write a few words.' });
    }
    if (transcript && !dto.audioUploadId) throw new BadRequestException('A transcript needs its recording');

    const timeZone = isCountryCode(customer?.countryCode) ? COUNTRIES[customer!.countryCode as keyof typeof COUNTRIES].timezone : 'UTC';
    let window: { from: Date; to: Date };
    try {
      window = computeWindow(dto.when, { date: dto.date, slot: dto.timeSlot, timeZone });
    } catch (e) {
      if (e instanceof ScheduleError) throw new BadRequestException({ code: 'INVALID_TIME', message: e.message });
      throw e;
    }

    const englishName = ((category.translations as any)?.en?.name as string | undefined) ?? category.name;
    const title = issues.length ? issues.slice(0, 2).map((i) => i.name).join(' & ') : englishName;
    const description = [typed, transcript].filter(Boolean).join('\n\n') || issues.map((i) => i.name).join(', ');
    const location = [address.buildingDetail, address.streetAddress, address.area, address.city].filter(Boolean).join(', ');
    const urgency = dto.isEmergency ? 'emergency' : dto.when === 'NOW' ? 'urgent' : 'standard';

    let jobId: string;
    try {
      jobId = await this.prisma.$transaction(async (tx) => {
        const photoKeys = dto.photoUploadIds?.length ? await this.storage.consume(user.id, dto.photoUploadIds, 'JOB_PHOTO', tx) : [];
        const [audioKey] = dto.audioUploadId ? await this.storage.consume(user.id, [dto.audioUploadId], 'JOB_AUDIO', tx) : [];

        const job = await tx.jobRequest.create({
          data: {
            customerId: user.id,
            customerName: customer?.name ?? 'Customer',
            categoryId: category.id,
            issueCodes,
            title,
            description,
            addressId: address.id,
            location,
            latitude: address.latitude,
            longitude: address.longitude,
            area: address.area,
            city: address.city,
            whenOption: dto.when,
            scheduledFrom: window.from,
            scheduledTo: window.to,
            requestedDate: dto.when,
            urgency,
            isEmergency: dto.isEmergency ?? false,
            idempotencyKey: dto.idempotencyKey,
            // Real matching arrives in Phase 5; until then a new request is open to workers.
            status: 'MATCHES_FOUND',
            media: {
              create: [
                ...photoKeys.map((storageKey) => ({ kind: 'PHOTO' as const, storageKey, mime: 'image/jpeg', createdById: user.id })),
                ...(audioKey ? [{ kind: 'AUDIO' as const, storageKey: audioKey, mime: 'audio/mp4', transcript: transcript || null, createdById: user.id }] : []),
              ],
            },
            events: { create: [{ type: 'REQUEST_SENT', actorId: user.id, toStatus: 'MATCHES_FOUND' }] },
          },
          select: { id: true },
        });

        if (dto.analysisId) {
          await tx.jobAiAnalysis.updateMany({
            where: { id: dto.analysisId, ownerId: user.id, jobRequestId: null },
            data: { jobRequestId: job.id },
          });
        }
        return job.id;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const again = await this.prisma.jobRequest.findUnique({
          where: { customerId_idempotencyKey: { customerId: user.id, idempotencyKey: dto.idempotencyKey } },
          select: { id: true },
        });
        if (again) return this.findById(again.id, user);
      }
      throw e;
    }

    // Tell nearby eligible professionals. A failure here never loses the request: the
    // background sweeper retries unmatched requests every minute.
    if (!opts.skipMatching) await this.matching.matchJob(jobId, 1).catch((e) => this.logger.error(`Matching failed for ${jobId}: ${(e as Error).message}`));
    void urgency;
    return this.findById(jobId, user);
  }

  // ── read ──────────────────────────────────────────────────

  async findAll(user: AuthUser, filters?: JobQueryDto) {
    await this.staff.assert(user, 'jobs.read');
    const and: Prisma.JobRequestWhereInput[] = [this.visibleTo(user)];
    if (filters?.status) and.push({ status: filters.status });
    if (filters?.group === 'active') and.push({ status: { in: BUSY_STATUSES } });
    if (filters?.group === 'past') and.push({ status: { in: ['COMPLETED', 'CANCELLED'] } });
    if (filters?.serviceId) and.push({ serviceId: filters.serviceId });

    const limit = filters?.limit ?? 20;
    const rows = await this.prisma.jobRequest.findMany({
      where: { AND: and },
      include: BASE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filters?.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map((j) => this.present(j, user)));
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async findById(id: string, user: AuthUser) {
    await this.staff.assert(user, 'jobs.read', 'disputes.read', 'safety.read');
    const job = await this.prisma.jobRequest.findFirst({
      where: { AND: [{ id }, this.visibleTo(user)] },
      include: DETAIL_INCLUDE,
    });
    // Same 404 whether it does not exist or belongs to someone else.
    if (!job) throw new NotFoundException('Job not found');
    return this.present(job, user);
  }

  /** Customer edits the request details while it is still open. */
  async update(id: string, dto: UpdateJobDto, user: AuthUser) {
    if (user.type !== 'customer') throw new ForbiddenException('Only the customer can edit a request');
    const result = await this.prisma.jobRequest.updateMany({
      where: { id, customerId: user.id, status: { in: ['CREATED', 'MATCHES_FOUND'] } },
      data: dto,
    });
    if (result.count === 0) await this.explainFailure(id, user);
    await this.prisma.jobEvent.create({ data: { jobRequestId: id, actorId: user.id, type: 'DETAILS_EDITED' } });
    return this.findById(id, user);
  }

  // ── transitions ───────────────────────────────────────────

  async requestWorker(id: string, workerId: string, user: AuthUser) {
    if (user.type !== 'customer') throw new ForbiddenException('Only the customer can choose a worker');
    const worker = await this.prisma.worker.findFirst({ where: { id: workerId, activationStatus: 'ACTIVE', balanceBlocked: false }, select: { id: true } });
    if (!worker || (await this.blocks.between(user.id, workerId))) throw new BadRequestException('That worker is not available');
    return this.transition(id, user, 'AWAITING_WORKER', {
      onlyIf: { customerId: user.id },
      data: { assignedWorkerId: workerId },
      event: { type: 'WORKER_REQUESTED', payload: { workerId } },
    });
  }

  async accept(id: string, user: AuthUser) {
    const out = await this.workerTransition(id, user, 'ACCEPTED', 'WORKER_ACCEPTED');
    this.events.emit('job.direct_answered', { jobId: id, workerId: user.id, accepted: true });
    return out;
  }

  async enRoute(id: string, user: AuthUser) {
    return this.workerTransition(id, user, 'EN_ROUTE', 'EN_ROUTE');
  }

  async arrive(id: string, user: AuthUser) {
    return this.workerTransition(id, user, 'ARRIVED', 'ARRIVED');
  }

  async start(id: string, user: AuthUser, dto: JobStepPhotosDto = {}) {
    if (user.type !== 'worker') throw new ForbiddenException('Only the assigned worker can do this');
    this.requirePhotoOrReason(dto, 'before');
    return this.transition(id, user, 'IN_PROGRESS', {
      onlyIf: { assignedWorkerId: user.id },
      event: { type: 'WORK_STARTED', payload: dto.photoSkipReason ? { photoSkipped: dto.photoSkipReason } : undefined },
      inTx: (tx) => this.attachPhotos(tx, id, user.id, dto.photoUploadIds, 'BEFORE'),
    });
  }

  async finish(id: string, user: AuthUser, dto: JobStepPhotosDto = {}) {
    if (user.type !== 'worker') throw new ForbiddenException('Only the assigned worker can do this');
    this.requirePhotoOrReason(dto, 'after');
    return this.transition(id, user, 'AWAITING_CONFIRMATION', {
      onlyIf: { assignedWorkerId: user.id },
      data: { finishedAt: new Date() },
      event: { type: 'WORK_FINISHED', payload: dto.photoSkipReason ? { photoSkipped: dto.photoSkipReason } : undefined },
      inTx: (tx) => this.attachPhotos(tx, id, user.id, dto.photoUploadIds, 'AFTER'),
    });
  }

  /** Evidence protects both sides (doc 22): a photo, or a stated reason why there isn't one. */
  private requirePhotoOrReason(dto: JobStepPhotosDto, which: 'before' | 'after') {
    if (this.config.get('REQUIRE_JOB_PHOTOS') === false) return;
    if (dto.photoUploadIds?.length || dto.photoSkipReason) return;
    throw new BadRequestException({
      code: 'PHOTO_REQUIRED',
      message: which === 'before' ? 'Take a photo of the problem before you start.' : 'Take a photo of the finished work.',
    });
  }

  /** Worker's own JOB_PHOTO uploads become the job's before/after evidence (real MIME, used once). */
  private async attachPhotos(tx: Prisma.TransactionClient, jobId: string, workerId: string, uploadIds: string[] | undefined, phase: 'BEFORE' | 'AFTER') {
    if (!uploadIds?.length) return;
    const files = await this.storage.consumeFiles(workerId, uploadIds, 'JOB_PHOTO', tx);
    await tx.jobMedia.createMany({ data: files.map((f) => ({ jobRequestId: jobId, kind: 'PHOTO' as const, phase, storageKey: f.key, mime: f.mime, createdById: workerId })) });
  }

  async confirm(id: string, user: AuthUser) {
    if (user.type !== 'customer') throw new ForbiddenException('Only a customer can confirm completion');
    return this.transition(id, user, 'COMPLETED', {
      onlyIf: { customerId: user.id },
      data: { completedAt: new Date() },
      event: { type: 'WORK_COMPLETED' },
    });
  }

  /**
   * The customer didn't confirm within AUTO_CONFIRM_HOURS of the worker finishing, and hasn't
   * opened a dispute: the job completes by itself (flagged, so ops can see it wasn't confirmed).
   */
  async autoConfirmDue(now = new Date()): Promise<number> {
    const hours = Number(this.config.get('AUTO_CONFIRM_HOURS') ?? 24);
    const due = await this.prisma.jobRequest.findMany({
      where: {
        status: 'AWAITING_CONFIRMATION',
        finishedAt: { lte: new Date(now.getTime() - hours * 3600_000) },
        disputes: { none: { status: { in: ['OPEN', 'IN_REVIEW'] } } },
      },
      select: { id: true, title: true, customerId: true, assignedWorkerId: true },
      take: 100,
    });
    let done = 0;
    for (const job of due) {
      const eventId = await this.prisma.$transaction(async (tx) => {
        const r = await tx.jobRequest.updateMany({
          where: { id: job.id, status: 'AWAITING_CONFIRMATION' },
          data: { status: 'COMPLETED', completedAt: now, autoConfirmed: true },
        });
        if (r.count === 0) return null;
        const ev = await tx.jobEvent.create({
          data: { jobRequestId: job.id, type: 'AUTO_CONFIRMED', fromStatus: 'AWAITING_CONFIRMATION', toStatus: 'COMPLETED', payload: { afterHours: hours } },
          select: { id: true },
        });
        await this.postSystemMessage(tx, job.id, job.customerId, job.assignedWorkerId, 'AUTO_CONFIRMED');
        return ev.id;
      });
      if (!eventId) continue;
      done++;
      await this.announce({ id: job.id, title: job.title, customerId: job.customerId, workerId: job.assignedWorkerId, previousWorkerId: job.assignedWorkerId }, 'COMPLETED', 'AUTO_CONFIRMED', eventId, { id: 'system', type: 'admin' });
    }
    return done;
  }

  /**
   * The other party's phone number, only while booked (O7 default: reveal after booking, hide
   * after). Every reveal is audited.
   */
  async contact(id: string, user: AuthUser) {
    const job = await this.prisma.jobRequest.findFirst({
      where: { id, OR: [{ customerId: user.id }, { assignedWorkerId: user.id }] },
      select: { status: true, customerId: true, assignedWorkerId: true, customer: { select: { name: true, phone: true } }, assignedWorker: { select: { user: { select: { name: true, phone: true } } } } },
    });
    if (!job || !job.assignedWorkerId) throw new NotFoundException('Job not found');
    if (!CONTACT_STATUSES.includes(job.status as JobStatus)) {
      throw new ConflictException({ code: 'CONTACT_UNAVAILABLE', message: 'Phone numbers are shown only while the job is booked. Use the chat instead.' });
    }
    const other = user.id === job.customerId ? job.assignedWorker?.user : job.customer;
    await this.audit.record({ actorId: user.id, action: 'job.contact_revealed', entityType: 'JobRequest', entityId: id });
    return { name: other?.name ?? null, phone: other?.phone ?? null };
  }

  /** Last known position of the professional on the way (customer only). */
  async liveLocation(id: string, user: AuthUser) {
    const job = await this.prisma.jobRequest.findFirst({ where: { id, customerId: user.id }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
    return { location: await this.location.latest(id) };
  }

  async decline(id: string, user: AuthUser) {
    if (user.type !== 'worker') throw new ForbiddenException('Only a worker can decline');
    const out = await this.transition(id, user, 'MATCHES_FOUND', {
      onlyIf: { assignedWorkerId: user.id },
      data: { assignedWorkerId: null },
      event: { type: 'WORKER_DECLINED' },
    });
    // SOS dispatch moves on to the next nearest worker at once.
    this.events.emit('job.direct_answered', { jobId: id, workerId: user.id, accepted: false });
    return out;
  }

  async cancel(id: string, user: AuthUser, dto: CancelJobDto = {}) {
    await this.staff.assert(user, 'jobs.cancel');
    const scope: Prisma.JobRequestWhereInput =
      user.type === 'customer' ? { customerId: user.id }
      : user.type === 'worker' ? { assignedWorkerId: user.id }
      : {};
    return this.transition(id, user, 'CANCELLED', {
      onlyIf: scope,
      data: { cancelReason: dto.reason ?? 'OTHER', cancelledById: user.id },
      event: { type: 'CANCELLED', payload: { reason: dto.reason ?? 'OTHER', note: dto.note?.trim() || undefined, by: user.type } },
    });
  }

  private async workerTransition(id: string, user: AuthUser, to: JobStatus, eventType: string) {
    if (user.type !== 'worker') throw new ForbiddenException('Only the assigned worker can do this');
    return this.transition(id, user, to, { onlyIf: { assignedWorkerId: user.id }, event: { type: eventType } });
  }

  /**
   * One atomic, validated status change plus its timeline event. The UPDATE is conditional on the
   * current status, so two simultaneous requests cannot both succeed.
   */
  private async transition(
    id: string,
    user: AuthUser,
    to: JobStatus,
    opts: {
      onlyIf: Prisma.JobRequestWhereInput;
      data?: Prisma.JobRequestUncheckedUpdateManyInput;
      event: { type: string; payload?: Record<string, unknown> };
      /** Extra writes that must commit with the status change (e.g. before/after photos). */
      inTx?: (tx: Prisma.TransactionClient) => Promise<void>;
    },
  ) {
    const job = await this.prisma.jobRequest.findFirst({
      where: { AND: [{ id }, this.visibleTo(user), opts.onlyIf] },
      select: { status: true, title: true, customerId: true, assignedWorkerId: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    const from = job.status as JobStatus;
    if (to === 'CANCELLED' && user.type === 'customer' && !canTransition(from, 'CANCELLED', 'customer')) {
      throw new ConflictException({ code: 'CANNOT_CANCEL_NOW', message: 'This job can no longer be cancelled here. Please contact support.' });
    }
    assertTransition(from, to, user.type as JobActor);
    // Cancelling after the worker set off is recorded as late (for fees later; none today).
    const payload = to === 'CANCELLED' && user.type === 'customer' && LATE_CANCEL_STATUSES.includes(from)
      ? { ...(opts.event.payload ?? {}), late: true }
      : opts.event.payload;

    const eventId = await this.prisma.$transaction(async (tx) => {
      const result = await tx.jobRequest.updateMany({
        where: { AND: [{ id }, opts.onlyIf], status: from },
        data: { status: to, ...(opts.data ?? {}) },
      });
      if (result.count === 0) throw new ConflictException('This job just changed. Please refresh and try again.');
      const ev = await tx.jobEvent.create({
        data: {
          jobRequestId: id, actorId: user.id, type: opts.event.type, fromStatus: from, toStatus: to,
          payload: payload as Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });
      if (opts.inTx) await opts.inTx(tx);
      const workerAfter = opts.data && 'assignedWorkerId' in opts.data ? (opts.data.assignedWorkerId as string | null) : job.assignedWorkerId;
      await this.postSystemMessage(tx, id, job.customerId, workerAfter, opts.event.type);

      return ev.id;
    });
    const workerId = opts.data && 'assignedWorkerId' in opts.data ? (opts.data.assignedWorkerId as string | null) : job.assignedWorkerId;
    await this.announce({ id, title: job.title, customerId: job.customerId, workerId, previousWorkerId: job.assignedWorkerId }, to, opts.event.type, eventId, user);
    return this.findById(id, user);
  }

  /**
   * The job's chat gets a line for each step both people should see. The conversation exists
   * from booking (created here if an older job has none).
   */
  private async postSystemMessage(tx: Prisma.TransactionClient, jobId: string, customerId: string, workerId: string | null, eventType: string) {
    const key = SYSTEM_MESSAGE_FOR[eventType];
    if (!key || !workerId) return;
    const conv = (await tx.conversation.findFirst({ where: { jobRequestId: jobId }, select: { id: true } }))
      ?? (await tx.conversation.create({ data: { jobRequestId: jobId, participants: { connect: [{ id: customerId }, { id: workerId }] } }, select: { id: true } }));
    await tx.message.create({ data: systemMessage(conv.id, key) });
    await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  }

  /** Tell the other side what just happened, live and (if they're away) by push. */
  private async announce(
    job: { id: string; title: string | null; customerId: string; workerId: string | null; previousWorkerId: string | null },
    to: JobStatus, eventType: string, eventId: string, actor: AuthUser,
  ) {
    this.realtime.emitToUsers([job.customerId, job.workerId ?? '', job.previousWorkerId ?? ''], 'job.updated', { jobId: job.id, status: to });
    const title = job.title ?? 'Repair';
    const workerName = async (id: string | null) =>
      id ? (await this.prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'Your professional' : 'Your professional';
    const toCustomer = (type: NotificationType, worker: string) => this.notifications.notify({
      type, userIds: [job.customerId], eventKey: `${type}:${eventId}`,
      params: { title, worker }, data: { url: routes.customerJob(job.id), jobId: job.id },
    });
    const toWorker = (type: NotificationType) => job.workerId ? this.notifications.notify({
      type, userIds: [job.workerId], eventKey: `${type}:${eventId}`,
      params: { title }, data: { url: routes.workerJob(job.id), jobId: job.id },
    }) : Promise.resolve(0);

    switch (eventType) {
      case 'WORKER_REQUESTED':
        if (job.workerId) {
          await this.notifications.notify({
            type: 'job.direct_request', userIds: [job.workerId], eventKey: `job.direct_request:${eventId}`,
            params: { title }, data: { url: routes.workerJob(job.id), jobId: job.id },
          });
        }
        return;
      case 'WORKER_ACCEPTED': return void (await toCustomer('job.accepted', await workerName(job.workerId)));
      case 'EN_ROUTE': return void (await toCustomer('job.en_route', await workerName(job.workerId)));
      case 'ARRIVED': return void (await toCustomer('job.arrived', await workerName(job.workerId)));
      case 'WORK_STARTED': return void (await toCustomer('job.started', await workerName(job.workerId)));
      case 'WORK_FINISHED': return void (await toCustomer('job.awaiting_confirmation', await workerName(job.workerId)));
      // The customer confirmed: the worker is the one to tell.
      case 'WORK_COMPLETED': return void (await toWorker('job.confirmed'));
      case 'AUTO_CONFIRMED':
        await toWorker('job.auto_confirmed');
        await toCustomer('job.auto_confirmed', await workerName(job.workerId));
        return;
      case 'WORKER_DECLINED': return void (await toCustomer('job.declined', await workerName(job.previousWorkerId)));
      case 'CANCELLED': {
        // Whoever didn't cancel hears about it.
        const others = [job.customerId, job.workerId].filter((u): u is string => !!u && u !== actor.id);
        for (const u of others) {
          await this.notifications.notify({
            type: 'job.cancelled', userIds: [u], eventKey: `job.cancelled:${eventId}`, params: { title },
            data: { url: routes.jobFor(job.id, u === job.customerId ? 'customer' : 'worker'), jobId: job.id },
          });
        }
        return;
      }
    }
  }

  private async explainFailure(id: string, user: AuthUser): Promise<never> {
    const exists = await this.prisma.jobRequest.findFirst({ where: { AND: [{ id }, this.visibleTo(user)] }, select: { id: true } });
    if (!exists) throw new NotFoundException('Job not found');
    throw new ConflictException('This request can no longer be changed');
  }
}
