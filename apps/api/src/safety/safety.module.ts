import { Module } from '@nestjs/common';
import { SafetyService } from './safety.service';
import { SafetyController } from './safety.controller';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { LoggingSmsProvider, SMS_PROVIDER } from './sms.provider';

@Module({
  imports: [DatabaseModule, JobsModule],
  providers: [SafetyService, { provide: SMS_PROVIDER, useFactory: () => new LoggingSmsProvider(process.env.NODE_ENV === 'production') }],
  exports: [SMS_PROVIDER],
  controllers: [SafetyController]
})
export class SafetyModule {}
