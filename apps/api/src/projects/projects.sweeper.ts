import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeaseService } from '../common/lease/lease.service';
import { PrismaService } from '../database/prisma.service';
import { MilestonesService } from './milestones.service';
import { ProjectMatchingService } from './project-matching.service';

const EVERY_MS = 60_000;
const REINVITE_EVERY_MS = 3_600_000;
/** Open projects with fewer prices than this keep being shown to new professionals… */
const WANTED_BIDS = 3;
/** …for this long. */
const REINVITE_DAYS = 14;

/** On one instance (lease): close silent stages, send due refunds, and find more professionals. */
@Injectable()
export class ProjectsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsSweeper.name);
  private timer?: NodeJS.Timeout;
  private lastInvite = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly milestones: MilestonesService,
    private readonly matching: ProjectMatchingService,
    private readonly lease: LeaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('RUN_BACKGROUND_JOBS') === true) {
      this.lease.expect('projects', EVERY_MS);
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), EVERY_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  sweep(now = new Date()) {
    return this.lease.runExclusive('projects', 5 * 60_000, async () => ({
      autoClosed: await this.milestones.autoApproveDue(now),
      refunded: await this.milestones.sendRefunds(),
      invited: await this.reinvite(now),
    }));
  }

  private async reinvite(now: Date) {
    if (now.getTime() - this.lastInvite < REINVITE_EVERY_MS) return 0;
    this.lastInvite = now.getTime();
    const open = await this.prisma.project.findMany({
      where: { status: 'OPEN', publishedAt: { gte: new Date(now.getTime() - REINVITE_DAYS * 86_400_000) } },
      select: { id: true, _count: { select: { bids: { where: { status: 'PENDING' } } } } },
      orderBy: { publishedAt: 'desc' }, take: 200,
    });
    let n = 0;
    for (const p of open.filter((x) => x._count.bids < WANTED_BIDS)) n += await this.matching.invite(p.id);
    return n;
  }
}
