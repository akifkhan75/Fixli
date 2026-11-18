import { Module } from '@nestjs/common';
import { SafetyService } from './safety.service';
import { SafetyController } from './safety.controller';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [DatabaseModule, JobsModule],
  providers: [SafetyService],
  controllers: [SafetyController]
})
export class SafetyModule {}
