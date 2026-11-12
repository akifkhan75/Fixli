import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminVerificationService } from './admin-verification.service';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { AdminGateway } from './gateways/admin.gateway';

@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminVerificationService, AdminService, AdminGateway] })
export class AdminModule {}
