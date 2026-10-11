import { BlocksService } from '../blocks/blocks.service';
import { routes } from '@fixli/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { availableDuring, matchScore } from './rules';

interface Candidate {
  id: string;
  rating: number;
  radius: number;
  timezone: string;
  distance_km: number | null;
  rating_count: bigint | number;
}

const MAX_RADIUS_KM = 50;

/**
 * Finds eligible professionals for an open request and tells them about it.
 * Hard filters (doc 04 F): approved, online, not paused for unpaid commission, active account, has the skill, within their own
 * travel radius, working during the requested time, not already told about this job.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  private num(key: string, def: number) {
    return Number(this.config.get(key) ?? def);
  }

  async matchJob(jobId: string, round: 1 | 2): Promise<number> {
    const job = await this.prisma.jobRequest.findUnique({
      where: { id: jobId },
      select: {
        id: true, status: true, customerId: true, categoryId: true, latitude: true, longitude: true, city: true,
        area: true, title: true, scheduledFrom: true, scheduledTo: true, isEmergency: true,
      },
    });
    if (!job || job.status !== 'MATCHES_FOUND' || !job.categoryId) return 0;

    const factor = round === 2 ? this.num('REMATCH_RADIUS_FACTOR', 1.5) : 1;
    const limit = this.num('MATCH_NOTIFY_LIMIT', 10);
    const candidates = await this.findCandidates(job, factor);

    const from = job.scheduledFrom ?? new Date();
    const to = job.scheduledTo ?? new Date(from.getTime() + 2 * 3600_000);
    const hours = await this.prisma.workingHours.findMany({ where: { workerId: { in: candidates.map((c) => c.id) } } });
    const ranked = candidates
      .filter((c) => availableDuring(hours.filter((h) => h.workerId === c.id), c.timezone, from, to))
      .map((c) => ({
        workerId: c.id,
        distanceKm: c.distance_km == null ? null : Math.round(Number(c.distance_km) * 10) / 10,
        score: matchScore({ distanceKm: c.distance_km == null ? null : Number(c.distance_km), radiusKm: c.radius * factor, rating: c.rating, ratingCount: Number(c.rating_count) }),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    await this.prisma.$transaction(async (tx) => {
      if (ranked.length) {
        await tx.jobMatch.createMany({
          data: ranked.map((r, i) => ({ jobRequestId: job.id, workerId: r.workerId, round, rank: i + 1, score: r.score, distanceKm: r.distanceKm })),
          skipDuplicates: true,
        });
      }
      await tx.jobRequest.update({ where: { id: job.id }, data: { matchRound: round, lastMatchedAt: new Date() } });
      await tx.jobEvent.create({
        data: {
          jobRequestId: job.id,
          type: ranked.length ? 'PROFESSIONALS_NOTIFIED' : round === 1 ? 'NO_ONE_NEARBY_YET' : 'STILL_NO_ONE',
          payload: { round, notified: ranked.length },
        },
      });
    });

    // Minimal payload: no customer identity, no exact address (doc 05 §6).
    for (const r of ranked) {
      await this.notifications.notify({
        type: 'job.request', userIds: [r.workerId], eventKey: `job.request:${job.id}`,
        params: { title: job.title ?? 'Repair', area: job.area ?? job.city ?? undefined, distance: r.distanceKm ?? undefined },
        data: { url: routes.workerJob(job.id), jobId: job.id, isEmergency: job.isEmergency },
      });
    }
    if (ranked.length) this.realtime.emitToUsers(ranked.map((r) => r.workerId), 'feed.updated', { jobId: job.id });
    this.realtime.emitToUsers([job.customerId], 'job.updated', { jobId: job.id, status: job.status });
    if (!ranked.length && round === 2) {
      // Honest, once: we widened the search and still nobody is free. The request stays open.
      await this.notifications.notify({
        type: 'job.no_one_available', userIds: [job.customerId], eventKey: `job.no_one_available:${job.id}`,
        params: { title: job.title ?? 'your request' }, data: { url: routes.customerJob(job.id), jobId: job.id },
      });
    }
    this.logger.log(`Job ${job.id} round ${round}: ${candidates.length} in range, ${ranked.length} notified`);
    return ranked.length;
  }

  private async findCandidates(
    job: { id: string; customerId: string; categoryId: string | null; latitude: number | null; longitude: number | null; city: string | null },
    factor: number,
  ): Promise<Candidate[]> {
    const base = Prisma.sql`
      FROM "Worker" w
      JOIN "User" u ON u.id = w.id
      JOIN "WorkerService" ws ON ws."workerId" = w.id AND ws."categoryId" = ${job.categoryId}
      WHERE w."activationStatus" = 'ACTIVE'
        AND w."isOnline" = true
        AND w."balanceBlocked" = false
        AND u.status = 'ACTIVE'
        AND w.id <> ${job.customerId}
        AND ${BlocksService.notBlockedSql(job.customerId)}
        AND NOT EXISTS (SELECT 1 FROM "JobMatch" m WHERE m."jobRequestId" = ${job.id} AND m."workerId" = w.id)`;

    if (job.latitude != null && job.longitude != null) {
      const lat = job.latitude;
      const lng = job.longitude;
      const latDeg = (MAX_RADIUS_KM * factor) / 111;
      const lngDeg = latDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      // Bounding box first (index), exact great-circle distance second, all in the database.
      return this.prisma.$queryRaw<Candidate[]>`
        SELECT * FROM (
          SELECT w.id, w.rating, w."serviceRadius" AS radius, w.timezone,
            (6371 * acos(least(1, greatest(-1,
              cos(radians(${lat})) * cos(radians(w."serviceLat")) * cos(radians(w."serviceLng") - radians(${lng}))
              + sin(radians(${lat})) * sin(radians(w."serviceLat"))))))::float8 AS distance_km,
            (SELECT count(*) FROM "Review" r WHERE r."targetId" = w.id) AS rating_count
          ${base}
            AND w."serviceLat" BETWEEN ${lat - latDeg} AND ${lat + latDeg}
            AND w."serviceLng" BETWEEN ${lng - lngDeg} AND ${lng + lngDeg}
        ) c
        WHERE c.distance_km <= c.radius * ${factor}
        ORDER BY c.distance_km ASC
        LIMIT 100`;
    }

    if (!job.city) return [];
    // No GPS on the address: fall back to the city named in the worker's service area.
    return this.prisma.$queryRaw<Candidate[]>`
      SELECT w.id, w.rating, w."serviceRadius" AS radius, w.timezone, NULL::float8 AS distance_km,
        (SELECT count(*) FROM "Review" r WHERE r."targetId" = w.id) AS rating_count
      ${base}
        AND w."serviceAreaLabel" ILIKE ${'%' + job.city.trim() + '%'}
      LIMIT 100`;
  }
}
