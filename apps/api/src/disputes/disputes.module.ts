import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { DisputesController } from './disputes.controller';
import { DatabaseModule } from '../database/database.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [DatabaseModule, PaymentsModule, ProjectsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
