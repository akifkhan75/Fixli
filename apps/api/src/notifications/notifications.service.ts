import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PUSH_PROVIDER, PushProvider } from './push.provider';
import { Money, NotificationType, render } from './templates';

export interface NotifyInput {
  type: NotificationType;
  userIds: string[];
  /** Stable per real-world event, e.g. `offer.received:${offerId}`. Same key = sent once. */
  eventKey: string;
  params: Record<string, string | number | Money | undefined>;
  data: { url: string; jobId?: string; [k: string]: unknown };
  /** Default true. */
  push?: boolean;
}

/**
 * One way to tell someone something:
 *  1. stored (the in-app list; unique per user+eventKey, so retries never spam)
 *  2. sent live to any open app (notification.created)
 *  3. pushed to every signed-in device, in the user's language
 * Push runs in the background; a push failure never fails the action that caused it.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  /** Tests and graceful shutdown wait for background pushes. */
  async idle() {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  async notify(input: NotifyInput): Promise<number> {
    const userIds = [...new Set(input.userIds.filter(Boolean))];
    if (!userIds.length) return 0;
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds }, status: 'ACTIVE' }, select: { id: true, locale: true } });

    const made = await Promise.all(users.map(async (u) => {
      const { title, body } = render(input.type, u.locale, input.params);
      try {
        return await this.prisma.notification.create({
          data: { userId: u.id, type: input.type, title, body, data: input.data as Prisma.InputJsonValue, eventKey: input.eventKey },
          select: { id: true, userId: true, title: true, body: true, createdAt: true },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // P2002 = already told about this event: stay quiet
        return null;
      }
    }));
    const created = made.filter((n): n is NonNullable<typeof n> => n !== null);

    for (const n of created) {
      this.realtime.emitToUsers([n.userId], 'notification.created', {
        id: n.id, type: input.type, title: n.title, body: n.body, data: input.data, createdAt: n.createdAt,
      });
    }

    if (created.length && input.push !== false) {
      const p = this.sendPush(created, input).catch((e) => this.logger.error(`Push batch failed: ${(e as Error).message}`));
      this.inflight.add(p);
      void p.finally(() => this.inflight.delete(p));
    }
    return created.length;
  }

  private async sendPush(created: { id: string; userId: string; title: string; body: string }[], input: NotifyInput) {
    const sessions = await this.prisma.session.findMany({
      where: { userId: { in: created.map((c) => c.userId) }, revokedAt: null, expiresAt: { gt: new Date() }, pushToken: { not: null } },
      select: { id: true, userId: true, pushToken: true },
    });
    if (!sessions.length) return;
    const messages = sessions.map((s) => {
      const n = created.find((c) => c.userId === s.userId)!;
      return {
        session: s, notificationId: n.id,
        msg: { to: s.pushToken!, title: n.title, body: n.body, data: { ...input.data, notificationId: n.id }, channelId: input.type.startsWith('job.request') || input.type === 'job.sos_request' ? 'requests' : 'default' },
      };
    });
    const results = await this.push.send(messages.map((m) => m.msg));
    await Promise.all(results.map(async (r, i) => {
      const { session, notificationId } = messages[i];
      if (r.ok) {
        await this.prisma.notification.update({ where: { id: notificationId }, data: { pushedAt: new Date() } });
      } else {
        await this.prisma.notification.update({ where: { id: notificationId }, data: { pushError: r.error.slice(0, 120) } });
        // The phone uninstalled the app or the token rotated: stop sending to it.
        if (r.deadToken) await this.prisma.session.update({ where: { id: session.id }, data: { pushToken: null } });
      }
    }));
  }

  // ── the user's own list ──────────────────────────────────

  async list(userId: string, opts: { cursor?: string; limit?: number; since?: string }) {
    const limit = Math.min(50, opts.limit ?? 20);
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(opts.since ? { createdAt: { gt: new Date(opts.since) } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } }).then((count) => ({ count }));
  }

  async markRead(userId: string, ids?: string[]) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }
}
