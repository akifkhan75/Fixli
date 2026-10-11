import { Module } from '@nestjs/common';
import { SafetyService } from './safety.service';
import { SafetyController } from './safety.controller';
import { JobsModule } from '../jobs/jobs.module';
import { MatchingModule } from '../matching/matching.module';
import { SosService } from './sos.service';
import { SosSweeper } from './sos.sweeper';
import { NoSmsProvider, SMS_PROVIDER } from './sms.provider';

@Module({
  imports: [JobsModule, MatchingModule],
  providers: [SafetyService, SosService, SosSweeper, { provide: SMS_PROVIDER, useFactory: () => new NoSmsProvider() }],
  controllers: [SafetyController],
  exports: [SosService],
})
export class SafetyModule {}
