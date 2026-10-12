import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminService } from './admin.service';
import { StaffFeedService } from './staff-feed.service';
import { AdminConsoleService } from './admin-console.service';
import { AdminConsoleController } from './admin-console.controller';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [AdminController, AdminConsoleController],
  providers: [AdminVerificationService, AdminService, StaffFeedService, AdminConsoleService],
})
export class AdminModule {}
