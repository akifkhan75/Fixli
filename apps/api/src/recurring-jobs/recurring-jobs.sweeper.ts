import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeaseService } from '../common/lease/lease.service';
import { RecurringJobsService } from './recurring-jobs.service';

const EVERY_MS = 15 * 60_000;

/** Turns due recurring maintenance into real requests, on one instance, only when the feature is on. */
@Injectable()
export class RecurringJobsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringJobsSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly jobs: RecurringJobsService, private readonly lease: LeaseService, private readonly config: ConfigService) {}

  onModuleInit() {
    const enabled = (this.config.get<string[]>('ENABLED_FEATURES') ?? []).includes('recurring_jobs');
    if (enabled && this.config.get('RUN_BACKGROUND_JOBS') === true) {
      this.lease.expect('recurring-jobs', EVERY_MS);
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), EVERY_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  sweep(now = new Date()) {
    return this.lease.runExclusive('recurring-jobs', 5 * 60_000, () => this.jobs.runDue(now));
  }
}
