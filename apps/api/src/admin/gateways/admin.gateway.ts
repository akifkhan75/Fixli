import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DomainEvents } from '../../common/events/domain-events';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
@WebSocketGateway({
  namespace: '/admin',
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      const allowed = (process.env.FRONTEND_URL ?? '').split(',').map((o) => o.trim()).filter(Boolean);
      cb(null, !origin || allowed.includes(origin));
    },
    credentials: true,
  },
})
export class AdminGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AdminGateway.name);

  constructor(
    private readonly events: DomainEvents,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    this.events.on('admin.verification_submitted', (payload) => {
      this.server.to('admin:Verification').emit('verification.new', payload);
    });
    this.events.on('admin.dispute_opened', (payload) => {
      this.server.to('admin:Operations').emit('dispute.new', payload);
    });
    this.events.on('admin.incident_reported', (payload) => {
      this.server.to('admin:Safety').emit('incident.new', payload);
    });
    this.events.on('sessions.revoked', ({ sessionIds }) => {
      for (const sid of sessionIds) this.server?.in(`session:${sid}`).disconnectSockets(true);
    });
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? '';
      const payload = this.jwt.verify<{ sub: string; sid?: string }>(token);
      // Same rule as the /rt gateway: the token must belong to a live (not revoked/expired) session.
      const session = await this.prisma.session.findFirst({
        where: {
          id: payload.sid ?? '',
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE', type: 'admin' },
        },
        select: { user: { select: { id: true, adminRoles: true } } },
      });
      const admin = session?.user;
      if (!admin || !admin.adminRoles?.length) throw new Error('not an active admin session');

      const rooms = new Set<string>([`session:${payload.sid}`]);
      admin.adminRoles.forEach((role) => rooms.add(`admin:${role}`));
      if (admin.adminRoles.includes('Super Admin')) {
        ['Verification', 'Operations', 'Safety', 'Support', 'Finance'].forEach((role) => rooms.add(`admin:${role}`));
      }
      await client.join([...rooms]);
      client.data.userId = admin.id;
      client.data.sessionId = payload.sid;
      this.logger.log(`Admin ${admin.id} connected to realtime feed`);
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}
