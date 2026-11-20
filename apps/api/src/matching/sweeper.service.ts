import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { MatchingService } from './matching.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LeaseService } from '../common/lease/lease.service';

const LEASE = 'sweeper'; // one sweeper at a time across all API instances
const LEASE_MS = 5 * 60_000; // a crashed runner's lease lapses after this
const EVERY_MS = 60_000;

/**
 * Background housekeeping, once a minute:
 *  - expire offers past their time limit
 *  - match new requests that were not matched at creation (e.g. a transient failure)
 *  - widen the search once for requests nobody has answered
 * A lease (LeaseService) keeps it to a single runner even with several API instances.
 */
@Injectable()
export class SweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly lease: LeaseService,
  ) {}

  onModuleInit() {
    if (this.config.get('RUN_BACKGROUND_JOBS') === true || this.config.get('RUN_BACKGROUND_JOBS') === 'true') {
      this.lease.expect(LEASE, EVERY_MS);
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), EVERY_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  sweep(now = new Date()): Promise<{ expired: number; matched: number; widened: number; readOnly?: number } | null> {
    return this.lease.runExclusive(LEASE, LEASE_MS, () => this.run(now));
  }

  private async run(now: Date) {
    {
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
            updatedAt: { lte: cutoff },
            // A problem is being looked at: both sides may still need to talk.
            disputes: { none: { status: { in: ['OPEN', 'IN_REVIEW'] } } },
          }
        },
        data: { isReadOnly: true, closedAt: now }
      });

      return { expired: expired.count, matched: unmatched.length, widened: stale.length, readOnly: readOnlyCount.count };
    }
  }
}
