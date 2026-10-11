import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChatService } from '../chat.service';
import { PrismaService } from '../../database/prisma.service';
import { DomainEvents } from '../../common/events/domain-events';
import { RealtimeService } from '../../realtime/realtime.service';
import { LiveLocationService } from '../../tracking/live-location.service';
import { FEED_PERMISSIONS, hasPermission } from '../../common/auth/permissions';

class SendMessagePayload {
  @IsString() @IsNotEmpty() @MaxLength(64) threadId: string;
  @IsOptional() @IsString() @MaxLength(4000) text?: string;
  @IsOptional() @IsString() @MaxLength(64) imageUploadId?: string;
  @IsOptional() @IsString() @MaxLength(128) clientId?: string;
}
class ThreadPayload {
  @IsString() @IsNotEmpty() @MaxLength(64) threadId: string;
}
class LocationPayload {
  @IsString() @IsNotEmpty() @MaxLength(64) jobId: string;
  @IsLatitude() latitude: number;
  @IsLongitude() longitude: number;
  @IsOptional() @IsNumber() heading?: number;
}

function parse<T extends object>(cls: new () => T, data: unknown): T | null {
  const obj = plainToInstance(cls, data);
  return validateSync(obj as object, { whitelist: true, forbidNonWhitelisted: true }).length ? null : obj;
}

interface AuthedSocket extends Socket {
  data: { userId: string; userType: string; sessionId?: string };
}

@WebSocketGateway({
  namespace: '/rt',
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      const allowed = (process.env.FRONTEND_URL ?? '').split(',').map((o) => o.trim()).filter(Boolean);
      cb(null, !origin || allowed.includes(origin));
    },
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly realtime: RealtimeService,
    private readonly location: LiveLocationService,
  ) {
    this.events.on('sessions.revoked', ({ sessionIds }) => {
      for (const sid of sessionIds) this.server?.in(`session:${sid}`).disconnectSockets(true);
    });
  }

  afterInit(server: Server) {
    // Hand the live server to the publisher used by jobs, offers, notifications and chat.
    this.realtime.attach(server as any);
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string | undefined) ?? '';
      const payload = this.jwt.verify<{ sub: string; sid?: string }>(token);
      const session = await this.prisma.session.findFirst({
        where: {
          id: payload.sid ?? '',
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE' },
        },
        select: { user: { select: { id: true, type: true, adminRoles: true } } },
      });
      if (!session) throw new Error('no live session');
      const user = session.user;

      client.data.userId = user.id;
      client.data.userType = user.type;
      client.data.sessionId = payload.sid;
      // Staff also join one room per live-feed permission their roles grant. Roles are read here,
      // from the database; changing someone's roles signs them out, so they reconnect with the new set.
      const staffRooms = user.type === 'admin' ? FEED_PERMISSIONS.filter((p) => hasPermission(user.adminRoles, p)).map((p) => `staff:${p}`) : [];
      await client.join([`user:${user.id}`, `role:${user.type}`, `session:${payload.sid}`, ...staffRooms]);
      client.emit('ready', { userId: user.id });
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(@ConnectedSocket() client: AuthedSocket, @MessageBody() raw: unknown) {
    const data = parse(SendMessagePayload, raw);
    if (!data || !client.data.userId) return { error: 'INVALID' };

    const message = await this.chatService.sendMessage(client.data.userId, data);
    
    // Find conversation participants
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: data.threadId },
      include: { participants: { select: { id: true } } }
    });

    if (conversation) {
      for (const p of conversation.participants) {
        if (p.id !== client.data.userId) {
          this.server.to(`user:${p.id}`).emit('message.created', message);
        }
      }
    }

    client.emit('message.created', message);
    return message;
  }

  @SubscribeMessage('typing')
  async handleTyping(@ConnectedSocket() client: AuthedSocket, @MessageBody() raw: unknown) {
    const data = parse(ThreadPayload, raw);
    if (!data || !client.data.userId) return;
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: data.threadId, participants: { some: { id: client.data.userId } } },
      include: { participants: { select: { id: true } } }
    });
    if (conversation) {
      const other = conversation.participants.find((p) => p.id !== client.data.userId);
      if (other) this.server.to(`user:${other.id}`).emit('typing', { threadId: data.threadId, userId: client.data.userId });
    }
  }

  @SubscribeMessage('locationUpdate')
  async handleLocationUpdate(@ConnectedSocket() client: AuthedSocket, @MessageBody() raw: unknown) {
    const data = parse(LocationPayload, raw);
    if (!data || client.data.userType !== 'worker') return;
    // Only the assigned worker, only while on the way; throttled, stored sparsely, with an ETA.
    const out = await this.location.accept(client.data.userId, data);
    if (out) this.server.to(`user:${out.customerId}`).emit('locationUpdate', out.update);
  }

}
