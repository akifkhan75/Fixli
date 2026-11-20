import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { routes } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BlocksService } from '../blocks/blocks.service';
import { DomainEvents } from '../common/events/domain-events';
import { AuditService } from '../common/audit/audit.service';
import { detectContact } from './contact-detector';

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true } },
  reads: { select: { userId: true, readAt: true } },
} as const;

const TYPING_EVERY_MS = 3_000;
const firstName = (name?: string | null) => (name ?? 'Someone').trim().split(/\s+/)[0] || 'Someone';

export const REPORT_REASONS = ['HARASSMENT', 'SCAM', 'UNSAFE', 'INAPPROPRIATE', 'OTHER'] as const;

/**
 * Chat between a customer and their professional (doc 24 Phase 7, doc 27 F4). Sending is over
 * REST (idempotent by clientId, works from the offline outbox); every change reaches the other
 * side live through the /rt connection (message.created, message.read, conversation.updated,
 * chat.typing), on any API instance.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly lastTyping = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly blocks: BlocksService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  async getConversationsForUser(userId: string, cursor?: string) {
    const take = 20;
    const items = await this.prisma.conversation.findMany({
      where: { participants: { some: { id: userId } } },
      include: {
        participants: { select: { id: true, name: true, profileImageUrl: true } },
        jobRequest: { select: { id: true, title: true, status: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const nextCursor = items.length > take ? items.pop()!.id : null;

    const unreadCounts = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: items.map((i) => i.id) }, senderId: { not: userId }, reads: { none: { userId } } },
      _count: { id: true },
    });
    const unread = new Map(unreadCounts.map((u) => [u.conversationId, u._count.id]));
    const others = items.map((i) => i.participants.find((p) => p.id !== userId)?.id).filter((x): x is string => !!x);
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId, blockedId: { in: others } }, { blockedId: userId, blockerId: { in: others } }] },
      select: { blockerId: true, blockedId: true },
    });

    return {
      items: await Promise.all(items.map(async (item) => {
        const other = item.participants.find((p) => p.id !== userId) ?? null;
        return {
          id: item.id,
          job: item.jobRequest,
          counterpart: other,
          participants: item.participants,
          lastMessage: item.messages[0] ? await this.present(item.messages[0]) : null,
          lastMessageAt: item.lastMessageAt,
          unreadCount: unread.get(item.id) ?? 0,
          isReadOnly: item.isReadOnly,
          closedAt: item.closedAt,
          blockedByMe: !!other && blocks.some((b) => b.blockerId === userId && b.blockedId === other.id),
        };
      })),
      nextCursor,
    };
  }

  async requireConversation(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, participants: { some: { id: userId } } },
      include: { participants: { select: { id: true, name: true } }, jobRequest: { select: { id: true, title: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  /** The job's chat, for the "Message" button on a job screen. */
  async conversationForJob(jobId: string, userId: string) {
    const c = await this.prisma.conversation.findFirst({ where: { jobRequestId: jobId, participants: { some: { id: userId } } }, select: { id: true } });
    if (!c) throw new NotFoundException({ code: 'NO_CHAT_YET', message: 'Chat opens once the job is booked.' });
    return c;
  }

  async getMessages(conversationId: string, userId: string, cursor?: string, before?: string) {
    const conversation = await this.requireConversation(conversationId, userId);
    const take = 50;
    const items = await this.prisma.message.findMany({
      where: { conversationId, ...(before && { createdAt: { lt: new Date(before) } }) },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const nextCursor = items.length > take ? items.pop()!.id : null;
    const other = conversation.participants.find((p) => p.id !== userId) ?? null;
    return {
      items: await Promise.all(items.map((m) => this.present(m))),
      nextCursor,
      conversation: {
        id: conversation.id, job: conversation.jobRequest, counterpart: other,
        isReadOnly: conversation.isReadOnly, closedAt: conversation.closedAt,
        blocked: other ? await this.blocks.between(userId, other.id) : false,
      },
    };
  }

  async sendMessage(senderId: string, dto: { threadId: string; text?: string; imageUploadId?: string; clientId?: string }) {
    const conversation = await this.requireConversation(dto.threadId, senderId);
    if (dto.clientId) {
      // Retries from the outbox: same clientId, same message, nothing sent twice.
      const existing = await this.prisma.message.findUnique({
        where: { conversationId_clientId: { conversationId: dto.threadId, clientId: dto.clientId } },
        include: MESSAGE_INCLUDE,
      });
      if (existing) return this.present(existing);
    }
    if (conversation.isReadOnly) {
      throw new BadRequestException({ code: 'CONVERSATION_READ_ONLY', message: 'This chat is closed.' });
    }
    const others = conversation.participants.filter((p) => p.id !== senderId);
    for (const o of others) {
      if (await this.blocks.between(senderId, o.id)) throw new ForbiddenException({ code: 'BLOCKED', message: "You can't message this person." });
    }
    const text = dto.text?.trim() || undefined;
    if (!text && !dto.imageUploadId) throw new BadRequestException({ code: 'EMPTY_MESSAGE', message: 'Write a message or add a photo.' });

    const contact = detectContact(text);
    const message = await this.prisma.$transaction(async (tx) => {
      // The photo must be the sender's own finished CHAT_PHOTO upload, used once (Phase 3 rules).
      const [imageKey] = dto.imageUploadId ? await this.storage.consume(senderId, [dto.imageUploadId], 'CHAT_PHOTO', tx) : [];
      const m = await tx.message.create({
        data: { conversationId: dto.threadId, senderId, text, imageKey, isSystem: false, clientId: dto.clientId, isFlagged: contact.length > 0 },
        include: MESSAGE_INCLUDE,
      });
      await tx.conversation.update({ where: { id: dto.threadId }, data: { lastMessageAt: m.createdAt } });
      return m;
    });
    const out = await this.present(message);

    const everyone = conversation.participants.map((p) => p.id);
    this.realtime.emitToUsers(everyone, 'message.created', out); // the sender's other devices too
    this.realtime.emitToUsers(everyone, 'conversation.updated', { conversationId: dto.threadId });
    if (others.length) {
      const sender = conversation.participants.find((p) => p.id === senderId);
      // The push says who wrote, never what (doc 16 privacy, doc 27 F1.5).
      await this.notifications.notify({
        type: 'chat.message', userIds: others.map((p) => p.id), eventKey: `message:${message.id}`,
        params: { sender: firstName(sender?.name) },
        data: { url: routes.thread(dto.threadId), conversationId: dto.threadId },
      }).catch((e) => this.logger.error(`Chat notification failed: ${(e as Error).message}`));
    }
    // A gentle reminder for the sender only; the message itself is sent as written.
    return contact.length ? { ...out, warning: 'CONTACT_INFO' as const, contactKinds: contact } : out;
  }

  /** Images go out as short-lived signed links; storage keys never leave the server. */
  async present<T extends { imageKey?: string | null }>(m: T): Promise<Omit<T, 'imageKey'> & { imageUrl: string | null }> {
    const { imageKey, ...rest } = m;
    return { ...rest, imageUrl: imageKey ? await this.storage.signedUrlForKey(imageKey, 600) : null };
  }

  async markAsRead(conversationId: string, userId: string) {
    const conversation = await this.requireConversation(conversationId, userId);
    const unread = await this.prisma.message.findMany({
      where: { conversationId, senderId: { not: userId }, reads: { none: { userId } } },
      select: { id: true },
    });
    if (unread.length) {
      const readAt = new Date();
      await this.prisma.messageRead.createMany({ data: unread.map((m) => ({ messageId: m.id, userId, readAt })), skipDuplicates: true });
      const others = conversation.participants.map((p) => p.id).filter((id) => id !== userId);
      // Read ticks for the sender, live.
      this.realtime.emitToUsers(others, 'message.read', { conversationId, userId, messageIds: unread.map((m) => m.id), readAt });
      this.realtime.emitToUsers([userId], 'conversation.updated', { conversationId }); // my badge
    }
    return { success: true, read: unread.length };
  }

  /** At most one typing signal per person per chat every 3 s. */
  async typing(userId: string, conversationId: string) {
    const key = `${userId}:${conversationId}`;
    const now = Date.now();
    if ((this.lastTyping.get(key) ?? 0) > now - TYPING_EVERY_MS) return;
    this.lastTyping.set(key, now);
    if (this.lastTyping.size > 10_000) this.lastTyping.clear();
    const c = await this.prisma.conversation.findFirst({
      where: { id: conversationId, participants: { some: { id: userId } } },
      select: { participants: { select: { id: true } } },
    });
    if (!c) return;
    this.realtime.emitToUsers(c.participants.map((p) => p.id).filter((id) => id !== userId), 'chat.typing', { conversationId, userId });
  }

  /** Block the other person everywhere (chat, matching, prices, direct requests). */
  async blockUser(conversationId: string, blockerId: string, reason?: string) {
    const conversation = await this.requireConversation(conversationId, blockerId);
    const other = conversation.participants.find((p) => p.id !== blockerId);
    if (!other) throw new BadRequestException('No other user to block');
    await this.blocks.block(blockerId, other.id, reason, conversationId);
    await this.audit.record({ actorId: blockerId, action: 'user.blocked', entityType: 'User', entityId: other.id, after: { conversationId } });
    this.realtime.emitToUsers([blockerId, other.id], 'conversation.updated', { conversationId });
    return { success: true };
  }

  /** A report goes to the safety team as an incident (admin safety console, live staff feed). */
  async reportUser(conversationId: string, reporterId: string, reason: (typeof REPORT_REASONS)[number], details?: string) {
    const conversation = await this.requireConversation(conversationId, reporterId);
    const other = conversation.participants.find((p) => p.id !== reporterId);
    if (!other) throw new BadRequestException('No other user to report');
    const incident = await this.prisma.incident.create({
      data: {
        reporterId, targetId: other.id, jobRequestId: conversation.jobRequest?.id ?? null,
        type: 'REPORT_USER', severity: reason === 'UNSAFE' ? 'PROPERTY_DAMAGE' : 'MODERATE',
        description: [reason, details?.trim()].filter(Boolean).join(': ').slice(0, 2000),
      },
    });
    await this.audit.record({ actorId: reporterId, action: 'user.reported', entityType: 'User', entityId: other.id, after: { conversationId, reason, incidentId: incident.id } });
    this.events.emit('admin.incident_reported', { incidentId: incident.id, type: incident.type });
    return { success: true, incidentId: incident.id };
  }
}
