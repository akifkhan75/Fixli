import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Namespace } from 'socket.io';

/** Event names the app listens for. Payloads never contain an exact address or phone number. */
export type RealtimeEvent =
  | 'notification.created'
  | 'job.updated'
  | 'offers.updated'
  | 'feed.updated'
  // chat
  | 'message.created'
  | 'message.read'
  | 'conversation.updated'
  | 'chat.typing'
  // staff feed (admin portal)
  | 'staff.verification_submitted'
  | 'staff.dispute_opened'
  | 'staff.incident_reported'
  | 'staff.settlement_reported';

export interface Envelope<T = unknown> {
  id: string;
  type: RealtimeEvent;
  occurredAt: string;
  data: T;
}

/**
 * Sends events to the users' private rooms (user:{id}). With REDIS_URL set, the socket.io Redis
 * adapter fans this out across every API instance.
 *
 * Deliberately has no dependencies: the /rt gateway attaches its server once it starts. This keeps
 * the module graph acyclic (chat -> notifications -> realtime, never back to chat).
 */
@Injectable()
export class RealtimeService {
  private server?: Namespace;

  attach(server: Namespace) {
    this.server = server;
  }

  /** Staff holding `permission` (rooms joined at connect from their roles; see ChatGateway). */
  emitToStaff<T>(permission: string, type: RealtimeEvent, data: T): Envelope<T> {
    const envelope: Envelope<T> = { id: randomUUID(), type, occurredAt: new Date().toISOString(), data };
    this.server?.to(`staff:${permission}`).emit(type, envelope);
    return envelope;
  }

  emitToUsers<T>(userIds: string[], type: RealtimeEvent, data: T): Envelope<T> {
    const envelope: Envelope<T> = { id: randomUUID(), type, occurredAt: new Date().toISOString(), data };
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length && this.server) this.server.to(unique.map((u) => `user:${u}`)).emit(type, envelope);
    return envelope;
  }
}
