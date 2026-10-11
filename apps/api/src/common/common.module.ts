import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { JobAccessService } from './access/job-access.service';
import { DomainEvents } from './events/domain-events';
import { StaffAccessService } from './access/staff-access.service';

@Global()
@Module({
  providers: [AuditService, JobAccessService, DomainEvents, StaffAccessService],
  exports: [AuditService, JobAccessService, DomainEvents, StaffAccessService],
})
export class CommonModule {}
