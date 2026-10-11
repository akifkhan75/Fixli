import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminService } from './admin.service';
import { StaffFeedService } from './staff-feed.service';

@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminVerificationService, AdminService, StaffFeedService] })
export class AdminModule {}
