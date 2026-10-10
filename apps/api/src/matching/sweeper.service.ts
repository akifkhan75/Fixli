import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { MatchingService } from './matching.service';
import { RealtimeService } from '../realtime/realtime.service';

const LEASE = 'sweeper'; // one sweeper at a time across all API instances
const LEASE_MS = 5 * 60_000; // a crashed runner's lease lapses after this
const EVERY_MS = 60_000;

/**
 * Background housekeeping, once a minute:
 *  - expire offers past their time limit
 *  - match new requests that were not matched at creation (e.g. a transient failure)
 *  - widen the search once for requests nobody has answered
 * A lease row (SchedulerLease) keeps it to a single runner even with several API instances.
 * (A Postgres session advisory lock doesn't work here: Prisma's pool may lock on one connection
 * and unlock on another, leaving the lock held forever.)
 */
@Injectable()
export class SweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweeperService.name);
  private timer?: NodeJS.Timeout;
  private readonly holder = randomUUID();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    if (this.config.get('RUN_BACKGROUND_JOBS') === true || this.config.get('RUN_BACKGROUND_JOBS') === 'true') {
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), EVERY_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<{ expired: number; matched: number; widened: number; readOnly?: number } | null> {
    // A slow sweep must not overlap the next tick in this process either.
    if (this.running) return null;
    this.running = true;
    if (!(await this.acquire().catch((e) => { this.running = false; throw e; }))) { this.running = false; return null; }
    try {
      const due = await this.prisma.offer.findMany({
        where: { status: 'PENDING', expiresAt: { lte: now } },
        select: { id: true, jobRequestId: true, workerId: true, jobRequest: { select: { customerId: true } } }, take: 500,
      });
      const expired = await this.prisma.offer.updateMany({ where: { id: { in: due.map((o) => o.id) }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      for (const o of due) {
        this.realtime.emitToUsers([o.jobRequest.customerId], 'offers.updated', { jobId: o.jobRequestId });
        this.realtime.emitToUsers([o.workerId], 'feed.updated', { jobId: o.jobRequestId });
      }

      const unmatched = await this.prisma.jobRequest.findMany({
        where: { status: 'MATCHES_FOUND', matchRound: 0, createdAt: { lte: new Date(now.getTime() - 30_000) } },
        select: { id: true }, take: 50,
      });
      for (const j of unmatched) await this.matching.matchJob(j.id, 1);

      const after = Number(this.config.get('REMATCH_AFTER_MINUTES') ?? 15);
      const stale = await this.prisma.jobRequest.findMany({
        where: {
          status: 'MATCHES_FOUND', matchRound: 1,
          lastMatchedAt: { lte: new Date(now.getTime() - after * 60_000) },
          offers: { none: { status: 'PENDING' } },
        },
        select: { id: true }, take: 50,
      });
      for (const j of stale) await this.matching.matchJob(j.id, 2);

      const readonlyDays = Number(this.config.get('CONVERSATION_READONLY_DAYS') ?? 3);
      const cutoff = new Date(now.getTime() - readonlyDays * 24 * 60 * 60 * 1000);
      const readOnlyCount = await this.prisma.conversation.updateMany({
        where: {
          isReadOnly: false,
          jobRequest: {
            status: { in: ['COMPLETED', 'CANCELLED'] },
            updatedAt: { lte: cutoff }
          }
        },
        data: { isReadOnly: true }
      });

      return { expired: expired.count, matched: unmatched.length, widened: stale.length, readOnly: readOnlyCount.count };
    } finally {
      this.running = false;
      await this.prisma.$executeRaw`DELETE FROM "SchedulerLease" WHERE "name" = ${LEASE} AND "holder" = ${this.holder}`;
    }
  }

  /** Take the lease if it's free or lapsed. Atomic: two instances can't both win. */
  private async acquire(): Promise<boolean> {
    const at = new Date();
    const rows = await this.prisma.$queryRaw<{ holder: string }[]>`
      INSERT INTO "SchedulerLease" ("name", "holder", "expiresAt")
      VALUES (${LEASE}, ${this.holder}, ${new Date(at.getTime() + LEASE_MS)})
      ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "SchedulerLease"."expiresAt" < ${at} OR "SchedulerLease"."holder" = EXCLUDED."holder"
      RETURNING "holder"`;
    return rows.length > 0;
  }
}
