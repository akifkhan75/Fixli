import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeaseService } from '../common/lease/lease.service';
import { SosService } from './sos.service';

/** Every 15 s on one instance: SOS offers nobody answered move on to the next nearest worker. */
@Injectable()
export class SosSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SosSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly sos: SosService, private readonly lease: LeaseService, private readonly config: ConfigService) {}

  onModuleInit() {
    if (this.config.get('RUN_BACKGROUND_JOBS') === true) {
      this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(e)), 15_000);
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  sweep(now = new Date()) {
    return this.lease.runExclusive('sos', 60_000, () => this.sos.expireDue(now));
  }
}
