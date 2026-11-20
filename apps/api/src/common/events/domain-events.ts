import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

/** In-process events that let modules react to each other without importing each other. */
export interface DomainEventMap {
  /** These sessions were signed out: their live connections must drop now. */
  'sessions.revoked': { sessionIds: string[] };
  'admin.settlement_reported': { settlementId: string; workerId: string };
  /** A worker answered a direct request (accepted or declined). SOS dispatch listens. */
  'job.direct_answered': { jobId: string; workerId: string; accepted: boolean };
  'admin.verification_submitted': { caseId: string; workerId: string };
  'admin.dispute_opened': { disputeId: string; jobId: string };
  'admin.incident_reported': { incidentId: string; type: string };
}

@Injectable()
export class DomainEvents {
  private readonly bus = new EventEmitter().setMaxListeners(50);

  emit<K extends keyof DomainEventMap>(name: K, payload: DomainEventMap[K]) {
    this.bus.emit(name, payload);
  }

  on<K extends keyof DomainEventMap>(name: K, handler: (payload: DomainEventMap[K]) => void) {
    this.bus.on(name, handler);
    return () => this.bus.off(name, handler);
  }
}
