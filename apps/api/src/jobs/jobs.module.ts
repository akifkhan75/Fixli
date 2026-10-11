import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { MatchingModule } from '../matching/matching.module';
import { PaymentsModule } from '../payments/payments.module';
import { JobLifecycleSweeper } from './job-lifecycle.sweeper';

@Module({
  imports: [MatchingModule, PaymentsModule],
  controllers: [JobsController],
  providers: [JobsService, JobLifecycleSweeper],
  exports: [JobsService, JobLifecycleSweeper],
})
export class JobsModule {}
