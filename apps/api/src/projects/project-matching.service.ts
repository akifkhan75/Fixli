import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { routes } from '@fixli/shared';
import { BlocksService } from '../blocks/blocks.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';

/** People travel further for a project than for a quick repair. */
const RADIUS_FACTOR = 2;
const MAX_RADIUS_KM = 100;
export const PROJECT_INVITE_LIMIT = 40;

/**
 * Tells suitable professionals about an open project. Hard filters: approved, not paused for unpaid
 * commission, active account, has the skill, in the customer's currency, near enough, not blocked.
 * Being online or inside working hours doesn't matter: nobody has to start within the hour.
 */
@Injectable()
export class ProjectMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  async invite(projectId: string): Promise<number> {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, customerId: true, categoryId: true, latitude: true, longitude: true, city: true, area: true, title: true, currency: true, _count: { select: { invites: true } } },
    });
    if (!p || p.status !== 'OPEN') return 0;
    const room = PROJECT_INVITE_LIMIT - p._count.invites;
    if (room <= 0) return 0;

    const base = Prisma.sql`
      FROM "Worker" w
      JOIN "User" u ON u.id = w.id
      JOIN "WorkerService" ws ON ws."workerId" = w.id AND ws."categoryId" = ${p.categoryId}
      WHERE w."activationStatus" = 'ACTIVE'
        AND w."balanceBlocked" = false
        AND w.currency = ${p.currency}
        AND u.status = 'ACTIVE'
        AND w.id <> ${p.customerId}
        AND ${BlocksService.notBlockedSql(p.customerId)}
        AND NOT EXISTS (SELECT 1 FROM "ProjectInvite" i WHERE i."projectId" = ${p.id} AND i."workerId" = w.id)`;

    let found: { id: string; distance_km: number | null }[] = [];
    if (p.latitude != null && p.longitude != null) {
      const lat = p.latitude;
      const lng = p.longitude;
      const latDeg = MAX_RADIUS_KM / 111;
      const lngDeg = latDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      found = await this.prisma.$queryRaw`
        SELECT id, distance_km FROM (
          SELECT w.id, w.rating, w."serviceRadius" AS radius,
            (6371 * acos(least(1, greatest(-1,
              cos(radians(${lat})) * cos(radians(w."serviceLat")) * cos(radians(w."serviceLng") - radians(${lng}))
              + sin(radians(${lat})) * sin(radians(w."serviceLat"))))))::float8 AS distance_km
          ${base}
            AND w."serviceLat" BETWEEN ${lat - latDeg} AND ${lat + latDeg}
            AND w."serviceLng" BETWEEN ${lng - lngDeg} AND ${lng + lngDeg}
        ) c
        WHERE c.distance_km <= least(c.radius * ${RADIUS_FACTOR}, ${MAX_RADIUS_KM})
        ORDER BY c.rating DESC, c.distance_km ASC
        LIMIT ${room}`;
    } else if (p.city) {
      found = await this.prisma.$queryRaw`
        SELECT w.id, NULL::float8 AS distance_km ${base}
          AND w."serviceAreaLabel" ILIKE ${'%' + p.city.trim() + '%'}
        ORDER BY w.rating DESC
        LIMIT ${room}`;
    }
    if (!found.length) return 0;

    const rows = found.map((w) => ({ projectId: p.id, workerId: w.id, distanceKm: w.distance_km == null ? null : Math.round(Number(w.distance_km) * 10) / 10 }));
    await this.prisma.projectInvite.createMany({ data: rows, skipDuplicates: true });
    await Promise.all(rows.map((r) => this.notifications.notify({
      type: 'project.new', userIds: [r.workerId], eventKey: `project.new:${p.id}`,
      params: { title: p.title, area: p.area ?? p.city ?? undefined, distance: r.distanceKm ?? undefined },
      data: { url: routes.workerProject(p.id), projectId: p.id },
    })));
    this.realtime.emitToUsers(rows.map((r) => r.workerId), 'feed.updated', { projectId: p.id });
    return rows.length;
  }
}
