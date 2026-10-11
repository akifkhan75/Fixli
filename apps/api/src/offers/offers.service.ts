import { BUSY_STATUSES, IN_FLIGHT_STATUSES } from '../jobs/job-state-machine';

const IN_FLIGHT_BLOCK_MS = 3 * 3600_000;
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SubmitOfferDto } from './offer.dto';


@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  private ttlMs() {
    return Number(this.config.get('OFFER_TTL_MINUTES') ?? 10) * 60_000;
  }

  /** A worker can only act on a request the matching engine sent them, while it is open. */
  private async requireMatchedOpenJob(workerId: string, jobId: string) {
    const [worker, match] = await Promise.all([
      this.prisma.worker.findUnique({ where: { id: workerId }, select: { activationStatus: true, currency: true, balanceBlocked: true } }),
      this.prisma.jobMatch.findUnique({
        where: { jobRequestId_workerId: { jobRequestId: jobId, workerId } },
        include: { jobRequest: { select: { id: true, status: true, customerId: true, assignedWorkerId: true } } },
      }),
    ]);
    if (!match) throw new NotFoundException('Job not found');
    if (worker?.activationStatus !== 'ACTIVE') throw new ForbiddenException({ code: 'WORKER_NOT_ACTIVE', message: 'Your account must be approved to send prices.' });
    if (worker.balanceBlocked) throw new ForbiddenException({ code: 'COMMISSION_LIMIT', message: 'Settle what you owe Fixli to send new prices.' });
    if (match.declinedAt) throw new ConflictException({ code: 'ALREADY_DECLINED', message: 'You said this request is not for you.' });
    if (match.jobRequest.status !== 'MATCHES_FOUND' || match.jobRequest.assignedWorkerId) {
      throw new ConflictException({ code: 'REQUEST_CLOSED', message: 'This request is no longer open.' });
    }
    return { job: match.jobRequest, currency: worker.currency };
  }

  async submit(workerId: string, jobId: string, dto: SubmitOfferDto) {
    const { job, currency } = await this.requireMatchedOpenJob(workerId, jobId);
    const existing = await this.prisma.offer.findUnique({ where: { jobRequestId_workerId: { jobRequestId: jobId, workerId } } });
    if (existing && (existing.status === 'ACCEPTED' || existing.status === 'REJECTED')) {
      throw new ConflictException({ code: 'OFFER_CLOSED', message: 'The customer has already decided.' });
    }
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const data = { amount: dto.amount, currency, etaMinutes: dto.etaMinutes ?? null, note: dto.note?.trim() || null, status: 'PENDING' as const, expiresAt };

    const offer = await this.prisma.$transaction(async (tx) => {
      const o = existing
        ? await tx.offer.update({ where: { id: existing.id }, data })
        : await tx.offer.create({ data: { ...data, jobRequestId: jobId, workerId } });
      await tx.jobEvent.create({
        data: { jobRequestId: jobId, actorId: workerId, type: existing ? 'OFFER_REVISED' : 'OFFER_RECEIVED', payload: { workerId, amount: dto.amount, currency } },
      });
      return o;
    });
    this.realtime.emitToUsers([job.customerId], 'offers.updated', { jobId });
    if (!existing || existing.status !== 'PENDING') {
      // A first price (or a fresh one after it expired) is news; a revision just updates the list.
      const worker = await this.prisma.user.findUnique({ where: { id: workerId }, select: { name: true } });
      await this.notifications.notify({
        type: 'offer.received', userIds: [job.customerId], eventKey: `offer.received:${offer.id}:${expiresAt.getTime()}`,
        params: { worker: worker?.name ?? 'A professional', price: { minor: offer.amount, currency: offer.currency } },
        data: { url: `/(customer)/job/${jobId}`, jobId },
      });
    }
    return offer;
  }

  async withdraw(workerId: string, jobId: string) {
    const r = await this.prisma.offer.updateMany({ where: { jobRequestId: jobId, workerId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    if (r.count === 0) throw new NotFoundException('You have no open price on this request');
    await this.prisma.jobEvent.create({ data: { jobRequestId: jobId, actorId: workerId, type: 'OFFER_WITHDRAWN' } });
    await this.tellCustomerOffersChanged(jobId);
    return { success: true };
  }

  /** "Not for me": stop showing it, withdraw any price. */
  async notInterested(workerId: string, jobId: string) {
    const r = await this.prisma.jobMatch.updateMany({ where: { jobRequestId: jobId, workerId, declinedAt: null }, data: { declinedAt: new Date() } });
    if (r.count === 0) throw new NotFoundException('Job not found');
    const w = await this.prisma.offer.updateMany({ where: { jobRequestId: jobId, workerId, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
    if (w.count) await this.tellCustomerOffersChanged(jobId);
    return { success: true };
  }

  private async tellCustomerOffersChanged(jobId: string) {
    const job = await this.prisma.jobRequest.findUnique({ where: { id: jobId }, select: { customerId: true } });
    if (job) this.realtime.emitToUsers([job.customerId], 'offers.updated', { jobId });
  }

  /** Open requests sent to this worker, newest first, with their own offer if any. */
  async feed(workerId: string) {
    const matches = await this.prisma.jobMatch.findMany({
      where: { workerId, declinedAt: null, jobRequest: { status: 'MATCHES_FOUND', assignedWorkerId: null } },
      orderBy: { notifiedAt: 'desc' },
      take: 50,
      select: {
        distanceKm: true, notifiedAt: true,
        jobRequest: {
          select: {
            id: true, title: true, description: true, area: true, city: true, urgency: true, isEmergency: true, issueCodes: true,
            whenOption: true, scheduledFrom: true, scheduledTo: true, createdAt: true,
            category: { select: { id: true, name: true, iconName: true, translations: true } },
            offers: { where: { workerId }, select: { id: true, amount: true, currency: true, etaMinutes: true, status: true, expiresAt: true } },
          },
        },
      },
    });
    return matches.map((m) => {
      const { offers, ...job } = m.jobRequest;
      return { ...job, distanceKm: m.distanceKm, notifiedAt: m.notifiedAt, myOffer: offers[0] ?? null };
    });
  }

  /** The best few live offers for the customer, with what they need to choose (doc 22 §5.1 step 8). */
  async listForCustomer(customerId: string, jobId: string) {
    const job = await this.prisma.jobRequest.findFirst({ where: { id: jobId, customerId }, select: { id: true, status: true } });
    if (!job) throw new NotFoundException('Job not found');
    const offers = await this.prisma.offer.findMany({
      where: { jobRequestId: jobId, status: 'PENDING', expiresAt: { gt: new Date() } },
      select: {
        id: true, amount: true, currency: true, etaMinutes: true, note: true, expiresAt: true, createdAt: true,
        worker: {
          select: {
            id: true, rating: true, isVerified: true, experienceYears: true, hidePhotoUntilBooked: true,
            user: { select: { name: true, profileImageUrl: true } },
            matches: { where: { jobRequestId: jobId }, select: { score: true, distanceKm: true } },
            _count: { select: { assignedJobs: { where: { status: 'COMPLETED' } } } },
          },
        },
      },
    });
    const reviewCounts = await this.prisma.review.groupBy({ by: ['targetId'], where: { targetId: { in: offers.map((o) => o.worker.id) } }, _count: true });
    const limit = Number(this.config.get('MAX_OFFERS_SHOWN') ?? 3);
    return offers
      .map((o) => {
        const m = o.worker.matches[0];
        return {
          id: o.id, amount: o.amount, currency: o.currency, etaMinutes: o.etaMinutes, note: o.note, expiresAt: o.expiresAt,
          score: m?.score ?? 0,
          worker: {
            id: o.worker.id, name: o.worker.user.name,
            // Photo stays hidden until booked if the worker chose that (doc 22 §11.4).
            profileImageUrl: o.worker.hidePhotoUntilBooked ? null : o.worker.user.profileImageUrl,
            rating: o.worker.rating, ratingCount: reviewCounts.find((r) => r.targetId === o.worker.id)?._count ?? 0,
            jobsCompleted: o.worker._count.assignedJobs, isVerified: o.worker.isVerified, experienceYears: o.worker.experienceYears,
            distanceKm: m?.distanceKm ?? null,
          },
        };
      })
      .sort((a, b) => b.score - a.score || a.amount - b.amount)
      .slice(0, limit)
      .map(({ score, ...rest }) => rest);
  }

  /**
   * Customer chooses an offer: the job is booked at that price. Atomic and race-safe:
   *  - the job must still be open (conditional update), so two acceptances cannot both win
   *  - the worker row is locked, so two customers cannot book the same worker for overlapping times
   */
  async accept(customerId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId }, include: { jobRequest: true } });
    if (!offer || offer.jobRequest.customerId !== customerId) throw new NotFoundException('Offer not found');
    if (offer.status !== 'PENDING') throw new ConflictException({ code: 'OFFER_NOT_AVAILABLE', message: 'This price is no longer available.' });
    if (offer.expiresAt <= new Date()) throw new ConflictException({ code: 'OFFER_EXPIRED', message: 'This price has expired. Please choose another one.' });
    const job = offer.jobRequest;
    if (job.status !== 'MATCHES_FOUND') throw new ConflictException({ code: 'REQUEST_CLOSED', message: 'This request is no longer open.' });

    const from = job.scheduledFrom ?? new Date();
    const to = job.scheduledTo ?? new Date(from.getTime() + 2 * 3600_000);

    const losers = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Worker" WHERE id = ${offer.workerId} FOR UPDATE`;

      const clash = await tx.jobRequest.findFirst({
        where: {
          assignedWorkerId: offer.workerId, id: { not: job.id },
          OR: [
            // On a job right now (on the way, on site, working): can't also take something that
            // starts soon, whatever that job's booked window said.
            ...(from.getTime() < Date.now() + IN_FLIGHT_BLOCK_MS ? [{ status: { in: IN_FLIGHT_STATUSES } }] : []),
            // Booked but not finished: busy for that time window.
            { status: { in: BUSY_STATUSES }, scheduledFrom: { lt: to }, scheduledTo: { gt: from } },
          ],
        },
        select: { id: true },
      });
      if (clash) throw new ConflictException({ code: 'WORKER_BUSY', message: 'This professional was just booked for that time. Please choose another price.' });

      const booked = await tx.jobRequest.updateMany({
        where: { id: job.id, customerId, status: 'MATCHES_FOUND', assignedWorkerId: null },
        data: {
          status: 'ACCEPTED', assignedWorkerId: offer.workerId, agreedAmount: offer.amount, agreedCurrency: offer.currency,
          acceptedOfferId: offer.id, bookedAt: new Date(),
        },
      });
      if (booked.count === 0) throw new ConflictException({ code: 'REQUEST_CLOSED', message: 'This request just changed. Please refresh.' });

      const won = await tx.offer.updateMany({ where: { id: offer.id, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'ACCEPTED' } });
      if (won.count === 0) throw new ConflictException({ code: 'OFFER_NOT_AVAILABLE', message: 'This price is no longer available.' });
      const others = await tx.offer.findMany({ where: { jobRequestId: job.id, id: { not: offer.id }, status: 'PENDING' }, select: { id: true, workerId: true } });
      await tx.offer.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'REJECTED' } });
      await tx.jobEvent.create({
        data: {
          jobRequestId: job.id, actorId: customerId, type: 'OFFER_ACCEPTED', fromStatus: 'MATCHES_FOUND', toStatus: 'ACCEPTED',
          payload: { workerId: offer.workerId, amount: offer.amount, currency: offer.currency },
        },
      });
      await tx.conversation.create({
        data: {
          jobRequestId: job.id,
          participants: { connect: [{ id: customerId }, { id: offer.workerId }] }
        }
      });
      return others;
    });

    const title = job.title ?? 'Repair';
    await this.notifications.notify({
      type: 'offer.accepted', userIds: [offer.workerId], eventKey: `offer.accepted:${offer.id}`,
      params: { title }, data: { url: `/(worker)/job/${job.id}`, jobId: job.id },
    });
    for (const l of losers) {
      await this.notifications.notify({
        type: 'offer.not_chosen', userIds: [l.workerId], eventKey: `offer.not_chosen:${l.id}`,
        params: { title }, data: { url: '/(worker)/jobs', jobId: job.id }, push: false,
      });
    }
    // Everyone who was sent this request: it has left the open list.
    const matched = await this.prisma.jobMatch.findMany({ where: { jobRequestId: job.id }, select: { workerId: true } });
    this.realtime.emitToUsers(matched.map((m) => m.workerId), 'feed.updated', { jobId: job.id });
    this.realtime.emitToUsers([customerId, offer.workerId], 'job.updated', { jobId: job.id, status: 'ACCEPTED' });
    return { jobId: job.id, status: 'ACCEPTED', workerId: offer.workerId, amount: offer.amount, currency: offer.currency };
  }
}
