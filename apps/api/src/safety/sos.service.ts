import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { routes } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DomainEvents } from '../common/events/domain-events';

/**
 * Property emergencies (doc 22 D2, doc 25 O3e): the request goes to the single nearest free,
 * verified worker first, who has SOS_ACCEPT_SECONDS to accept; then the next nearest, up to
 * SOS_DIRECT_TRIES; then it falls back to normal offers from everyone nearby. Life-threatening
 * SOS never comes here: no worker is ever sent to a life-threatening situation.
 */
@Injectable()
export class SosService implements OnModuleDestroy {
  private readonly logger = new Logger(SosService.name);
  private readonly off: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    events: DomainEvents,
  ) {
    this.off = events.on('job.direct_answered', (e) => void this.onAnswer(e.jobId, e.workerId, e.accepted).catch((err) => this.logger.error(err)));
  }

  onModuleDestroy() { this.off(); }

  private seconds() { return Number(this.config.get('SOS_ACCEPT_SECONDS') ?? 180); }
  private tries() { return Number(this.config.get('SOS_DIRECT_TRIES') ?? 3); }

  async start(jobId: string, incidentId: string | null) {
    const d = await this.prisma.sosDispatch.create({ data: { jobRequestId: jobId, incidentId } });
    await this.offerNext(d.id);
    return this.prisma.sosDispatch.findUniqueOrThrow({ where: { id: d.id } });
  }

  /** Offer to the next nearest worker, or fall back to normal offers. */
  private async offerNext(dispatchId: string) {
    const d = await this.prisma.sosDispatch.findUniqueOrThrow({ where: { id: dispatchId }, include: { jobRequest: { select: { id: true, status: true, customerId: true, title: true, area: true } } } });
    if (d.status !== 'OFFERING') return;
    if (d.jobRequest.status !== 'MATCHES_FOUND') {
      // Still with a worker: wait. Cancelled: stop. Booked (whatever order events arrived in): done.
      if (d.jobRequest.status === 'AWAITING_WORKER') return;
      const final = d.jobRequest.status === 'CANCELLED' ? 'CANCELLED' : 'ACCEPTED';
      await this.prisma.sosDispatch.updateMany({ where: { id: d.id, status: 'OFFERING' }, data: { status: final, expiresAt: null } });
      return;
    }
    const attempt = d.attempt + 1;
    const pick = attempt <= this.tries() ? await this.matching.nearestForSos(d.jobRequestId, attempt) : null;
    if (!pick) return this.fallback(d.id, d.jobRequestId, d.jobRequest.customerId, d.jobRequest.title);

    const expiresAt = new Date(Date.now() + this.seconds() * 1000);
    const offered = await this.prisma.$transaction(async (tx) => {
      const r = await tx.jobRequest.updateMany({ where: { id: d.jobRequestId, status: 'MATCHES_FOUND', assignedWorkerId: null }, data: { status: 'AWAITING_WORKER', assignedWorkerId: pick.workerId } });
      if (r.count === 0) return false;
      const u = await tx.sosDispatch.updateMany({
        where: { id: d.id, status: 'OFFERING', attempt: d.attempt },
        data: { attempt, currentWorkerId: pick.workerId, expiresAt, triedWorkerIds: { push: pick.workerId } },
      });
      if (u.count === 0) throw new Error('dispatch changed'); // roll back the assignment
      await tx.jobEvent.create({ data: { jobRequestId: d.jobRequestId, type: 'SOS_OFFERED', fromStatus: 'MATCHES_FOUND', toStatus: 'AWAITING_WORKER', payload: { workerId: pick.workerId, attempt, distanceKm: pick.distanceKm, seconds: this.seconds() } } });
      return true;
    }).catch(() => false);
    if (!offered) return;

    await this.notifications.notify({
      type: 'job.sos_request', userIds: [pick.workerId], eventKey: `job.sos_request:${d.jobRequestId}:${attempt}`,
      params: { title: d.jobRequest.title ?? 'Emergency', area: d.jobRequest.area ?? undefined, distance: pick.distanceKm ?? undefined, minutes: Math.round(this.seconds() / 60) },
      data: { url: routes.workerJob(d.jobRequestId), jobId: d.jobRequestId, isEmergency: true },
    });
    this.realtime.emitToUsers([d.jobRequest.customerId, pick.workerId], 'job.updated', { jobId: d.jobRequestId, status: 'AWAITING_WORKER' });
  }

  private async fallback(dispatchId: string, jobId: string, customerId: string, title: string | null) {
    const r = await this.prisma.sosDispatch.updateMany({ where: { id: dispatchId, status: 'OFFERING' }, data: { status: 'FALLBACK', currentWorkerId: null, expiresAt: null } });
    if (r.count === 0) return;
    await this.prisma.jobEvent.create({ data: { jobRequestId: jobId, type: 'SOS_FALLBACK' } });
    const notified = await this.matching.matchJob(jobId, 1);
    await this.notifications.notify({
      type: 'sos.searching_wider', userIds: [customerId], eventKey: `sos.searching_wider:${jobId}`,
      params: { title: title ?? 'your emergency', count: notified },
      data: { url: routes.customerJob(jobId), jobId },
    });
    this.realtime.emitToUsers([customerId], 'job.updated', { jobId });
  }

  /** The worker answered (via the normal accept/decline). */
  async onAnswer(jobId: string, workerId: string, accepted: boolean) {
    const d = await this.prisma.sosDispatch.findUnique({ where: { jobRequestId: jobId } });
    if (!d || d.status !== 'OFFERING') return;
    if (accepted) {
      await this.prisma.sosDispatch.updateMany({ where: { id: d.id, status: 'OFFERING' }, data: { status: 'ACCEPTED', expiresAt: null } });
    } else {
      if (d.currentWorkerId !== workerId) return; // an old offer the sweeper already moved on from
      await this.prisma.sosDispatch.updateMany({ where: { id: d.id, status: 'OFFERING' }, data: { currentWorkerId: null, expiresAt: null } });
      await this.offerNext(d.id);
    }
  }

  /** Called every few seconds: offers nobody answered move on. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.sosDispatch.findMany({ where: { status: 'OFFERING', expiresAt: { lte: now } }, take: 50 });
    let n = 0;
    for (const d of due) {
      const r = await this.prisma.$transaction(async (tx) => {
        const back = await tx.jobRequest.updateMany({ where: { id: d.jobRequestId, status: 'AWAITING_WORKER', assignedWorkerId: d.currentWorkerId }, data: { status: 'MATCHES_FOUND', assignedWorkerId: null } });
        if (back.count) await tx.jobEvent.create({ data: { jobRequestId: d.jobRequestId, type: 'SOS_TIMED_OUT', fromStatus: 'AWAITING_WORKER', toStatus: 'MATCHES_FOUND', payload: { workerId: d.currentWorkerId, attempt: d.attempt } } });
        await tx.sosDispatch.updateMany({ where: { id: d.id, status: 'OFFERING', attempt: d.attempt }, data: { currentWorkerId: null, expiresAt: null } });
        return back.count;
      });
      if (d.currentWorkerId) this.realtime.emitToUsers([d.currentWorkerId], 'job.updated', { jobId: d.jobRequestId });
      if (r) n++;
      await this.offerNext(d.id);
    }
    return n;
  }
}
