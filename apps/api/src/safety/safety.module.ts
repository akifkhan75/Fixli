import { Module } from '@nestjs/common';
import { SafetyService } from './safety.service';
import { SafetyController } from './safety.controller';
import { JobsModule } from '../jobs/jobs.module';
import { MatchingModule } from '../matching/matching.module';
import { SosService } from './sos.service';
import { SosSweeper } from './sos.sweeper';

@Module({
  imports: [JobsModule, MatchingModule],
  providers: [SafetyService, SosService, SosSweeper],
  controllers: [SafetyController],
  exports: [SosService],
})
export class SafetyModule {}
