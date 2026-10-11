import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from './jobs.service';
import { LeaseService } from '../common/lease/lease.service';
import { LiveLocationService } from '../tracking/live-location.service';
import { PaymentsService } from '../payments/payments.service';
import { LedgerService } from '../money/ledger.service';

const EVERY_MS = 60_000;

/**
 * Once a minute, on one instance (lease): auto-confirm finished jobs and cash the customer left
 * unconfirmed, pause workers who have owed commission too long, and delete old location points.
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
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
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
      cashAutoConfirmed: await this.payments.autoConfirmDue(now),
      workersPausedForBalance: await this.ledger.refreshBlocks(now),
      locationPointsDeleted: await this.location.purgeOld(now),
    }));
  }
}
