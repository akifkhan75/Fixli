import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RoutingProvider, ROUTING_PROVIDER } from './routing.provider';

const FORWARD_EVERY_MS = 5_000;
const STORE_EVERY_MS = 30_000;

export interface LiveLocation { jobId: string; workerId: string; latitude: number; longitude: number; heading?: number; etaMinutes: number | null; at: string }

/**
 * Worker position while on the way to a job (doc 24 Phase 8, doc 26 8.9):
 *  - accepted only from the assigned worker, only while the job is EN_ROUTE
 *  - forwarded to the job's customer at most every 5 s, with an approximate ETA
 *  - stored at most every 30 s, deleted after LOCATION_RETENTION_DAYS
 */
@Injectable()
export class LiveLocationService {
  private readonly lastForward = new Map<string, number>();
  private readonly lastStored = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
  ) {}

  /** Returns what to send to whom, or null to drop this update (not allowed, or too soon). */
  async accept(workerId: string, p: { jobId: string; latitude: number; longitude: number; heading?: number }, now = Date.now()) {
    if ((this.lastForward.get(p.jobId) ?? 0) > now - FORWARD_EVERY_MS) return null;
    const job = await this.prisma.jobRequest.findFirst({
      where: { id: p.jobId, assignedWorkerId: workerId, status: 'EN_ROUTE' },
      select: { customerId: true, latitude: true, longitude: true },
    });
    if (!job) return null;
    this.lastForward.set(p.jobId, now);

    if ((this.lastStored.get(p.jobId) ?? 0) <= now - STORE_EVERY_MS) {
      this.lastStored.set(p.jobId, now);
      await this.prisma.jobLocationPoint.create({ data: { jobRequestId: p.jobId, latitude: p.latitude, longitude: p.longitude, heading: p.heading ?? null, at: new Date(now) } });
    }

    const etaMinutes = job.latitude != null && job.longitude != null
      ? await this.routing.etaMinutes(p, { latitude: job.latitude, longitude: job.longitude }).catch(() => null)
      : null;
    const update: LiveLocation = { jobId: p.jobId, workerId, latitude: p.latitude, longitude: p.longitude, heading: p.heading, etaMinutes, at: new Date(now).toISOString() };
    return { customerId: job.customerId, update };
  }

  /** Last known position for the customer's job screen (e.g. after reopening the app). */
  async latest(jobId: string): Promise<Omit<LiveLocation, 'workerId'> | null> {
    const job = await this.prisma.jobRequest.findUnique({ where: { id: jobId }, select: { status: true, latitude: true, longitude: true } });
    if (job?.status !== 'EN_ROUTE') return null;
    const p = await this.prisma.jobLocationPoint.findFirst({ where: { jobRequestId: jobId }, orderBy: { at: 'desc' } });
    if (!p) return null;
    const etaMinutes = job.latitude != null && job.longitude != null ? await this.routing.etaMinutes(p, { latitude: job.latitude, longitude: job.longitude }).catch(() => null) : null;
    return { jobId, latitude: p.latitude, longitude: p.longitude, heading: p.heading ?? undefined, etaMinutes, at: p.at.toISOString() };
  }

  /** Retention (D-F3). Called by the job sweeper. */
  async purgeOld(now = new Date()) {
    const days = Number(this.config.get('LOCATION_RETENTION_DAYS') ?? 30);
    const r = await this.prisma.jobLocationPoint.deleteMany({ where: { at: { lt: new Date(now.getTime() - days * 86_400_000) } } });
    return r.count;
  }

  forget(jobId: string) {
    this.lastForward.delete(jobId);
    this.lastStored.delete(jobId);
  }
}
