import { Module } from '@nestjs/common';
import { RecurringJobsService } from './recurring-jobs.service';
import { RecurringJobsController } from './recurring-jobs.controller';
import { DatabaseModule } from '../database/database.module';
import { MatchingModule } from '../matching/matching.module';
import { RecurringJobsSweeper } from './recurring-jobs.sweeper';

@Module({
  imports: [DatabaseModule, MatchingModule],
  controllers: [RecurringJobsController],
  providers: [RecurringJobsService, RecurringJobsSweeper],
})
export class RecurringJobsModule {}
