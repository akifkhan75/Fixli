import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DomainEvents } from '../common/events/domain-events';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Live feed for the admin portal: new verification cases, disputes and safety incidents go to
 * the staff whose roles allow them (verification.read / disputes.read / safety.read), over the
 * same authenticated /rt connection everyone else uses. Payloads are ids only.
 */
@Injectable()
export class StaffFeedService implements OnModuleDestroy {
  private readonly offs: (() => void)[];

  constructor(events: DomainEvents, realtime: RealtimeService) {
    this.offs = [
      events.on('admin.verification_submitted', (p) => realtime.emitToStaff('verification.read', 'staff.verification_submitted', p)),
      events.on('admin.dispute_opened', (p) => realtime.emitToStaff('disputes.read', 'staff.dispute_opened', p)),
      events.on('admin.incident_reported', (p) => realtime.emitToStaff('safety.read', 'staff.incident_reported', p)),
      events.on('admin.settlement_reported', (p) => realtime.emitToStaff('finance.read', 'staff.settlement_reported', p)),
    ];
  }

  onModuleDestroy() {
    this.offs.forEach((off) => off());
  }
}
