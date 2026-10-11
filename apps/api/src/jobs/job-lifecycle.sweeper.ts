import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from './jobs.service';
import { LeaseService } from '../common/lease/lease.service';
import { LiveLocationService } from '../tracking/live-location.service';

const EVERY_MS = 60_000;

/**
 * Once a minute, on one instance (lease): auto-confirm finished jobs the customer left
 * unconfirmed (AUTO_CONFIRM_HOURS), and delete live-location points past retention.
 */
@Injectable()
export class JobLifecycleSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobLifecycleSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly jobs: JobsService,
    private readonly location: LiveLocationService,
    private readonly lease: LeaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('RUN_BACKGROUND_JOBS') === true) {
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), EVERY_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  sweep(now = new Date()) {
    return this.lease.runExclusive('job-lifecycle', 5 * 60_000, async () => ({
      autoConfirmed: await this.jobs.autoConfirmDue(now),
      locationPointsDeleted: await this.location.purgeOld(now),
    }));
  }
}
