import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { systemMessage } from './system-messages';

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true } },
  reads: { select: { userId: true, readAt: true } },
} as const;

const firstName = (name?: string | null) => (name ?? 'Someone').trim().split(/\s+/)[0] || 'Someone';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
  ) {}

  async getConversationsForUser(userId: string, cursor?: string) {
    const take = 20;
    const items = await this.prisma.conversation.findMany({
      where: { participants: { some: { id: userId } } },
      include: {
        participants: { select: { id: true, name: true, profileImageUrl: true } },
        messages: { 
          take: 1, 
          orderBy: { createdAt: 'desc' } 
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    let nextCursor: string | null = null;
    if (items.length > take) {
      const nextItem = items.pop();
      nextCursor = nextItem!.id;
    }

    // Map unread counts
    const unreadCounts = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: items.map((i) => i.id) },
        senderId: { not: userId },
        reads: { none: { userId } }
      },
      _count: { id: true }
    });
    
    const unreadMap = new Map(unreadCounts.map(u => [u.conversationId, u._count.id]));

    return {
      items: await Promise.all(items.map(async (item) => ({
        ...item,
        messages: await Promise.all(item.messages.map((m) => this.present(m))),
        unreadCount: unreadMap.get(item.id) || 0,
      }))),
      nextCursor
    };
  }

  async requireConversation(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, participants: { some: { id: userId } } },
      include: { participants: { select: { id: true, name: true } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async getMessages(conversationId: string, userId: string, cursor?: string, before?: string) {
    await this.requireConversation(conversationId, userId);
    
    const take = 50;
    const items = await this.prisma.message.findMany({
      where: { conversationId, ...(before && { createdAt: { lt: new Date(before) } }) },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    let nextCursor: string | null = null;
    if (items.length > take) {
      const nextItem = items.pop();
      nextCursor = nextItem!.id;
    }

    return { items: await Promise.all(items.map((m) => this.present(m))), nextCursor };
  }

  async sendMessage(
    senderId: string,
    dto: { threadId: string; text?: string; imageUploadId?: string; clientId?: string },
  ) {
    const conversation = await this.requireConversation(dto.threadId, senderId);
    if (conversation.isReadOnly) {
      throw new BadRequestException({ code: 'CONVERSATION_READ_ONLY', message: 'This chat is closed.' });
    }
    const text = dto.text?.trim() || undefined;
    if (!text && !dto.imageUploadId) {
      throw new BadRequestException({ code: 'EMPTY_MESSAGE', message: 'Write a message or add a photo.' });
    }

    if (dto.clientId) {
      const existing = await this.prisma.message.findUnique({
        where: { conversationId_clientId: { conversationId: dto.threadId, clientId: dto.clientId } },
        include: MESSAGE_INCLUDE,
      });
      if (existing) return this.present(existing);
    }

    const hasContactInfo = !!text && (
      /[\d\s\-\+\(\)]{8,}/.test(text) || // basic phone heuristic (F4 replaces this detector)
      /https?:\/\/[^\s]+/.test(text) ||
      /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\b/i.test(text)
    );

    const message = await this.prisma.$transaction(async (tx) => {
      // The photo must be the sender's own finished CHAT_PHOTO upload, used once (Phase 3 rules).
      const [imageKey] = dto.imageUploadId ? await this.storage.consume(senderId, [dto.imageUploadId], 'CHAT_PHOTO', tx) : [];
      const m = await tx.message.create({
        data: { conversationId: dto.threadId, senderId, text, imageKey, isSystem: false, clientId: dto.clientId },
        include: MESSAGE_INCLUDE,
      });
      await tx.conversation.update({ where: { id: dto.threadId }, data: { lastMessageAt: new Date() } });
      if (hasContactInfo) await tx.message.create({ data: systemMessage(dto.threadId, 'chat.contact_warning') });
      return m;
    });

    const others = conversation.participants.filter((p) => p.id !== senderId);
    if (others.length) {
      const sender = conversation.participants.find((p) => p.id === senderId);
      // The push says who wrote, never what: message text stays out of lock screens and the
      // notification list (doc 16 privacy, doc 27 F1.5).
      await this.notifications.notify({
        type: 'chat.message',
        userIds: others.map((p) => p.id),
        eventKey: `message:${message.id}`,
        params: { sender: firstName(sender?.name) },
        data: { url: `/thread/${dto.threadId}`, conversationId: dto.threadId },
      }).catch((e) => this.logger.error(`Chat notification failed: ${(e as Error).message}`));
    }

    return this.present(message);
  }

  /** Images go out as short-lived signed links; storage keys never leave the server. */
  async present<T extends { imageKey?: string | null }>(m: T): Promise<Omit<T, 'imageKey'> & { imageUrl: string | null }> {
    const { imageKey, ...rest } = m;
    return { ...rest, imageUrl: imageKey ? await this.storage.signedUrlForKey(imageKey, 600) : null };
  }

  async markAsRead(conversationId: string, userId: string) {
    await this.requireConversation(conversationId, userId);
    
    // Find unread messages
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        reads: { none: { userId } }
      },
      select: { id: true }
    });

    if (unreadMessages.length > 0) {
      await this.prisma.messageRead.createMany({
        data: unreadMessages.map(m => ({
          messageId: m.id,
          userId
        })),
        skipDuplicates: true
      });
    }

    return { success: true };
  }

  async blockUser(conversationId: string, blockerId: string, reason?: string) {
    const conversation = await this.requireConversation(conversationId, blockerId);
    const blockedUser = conversation.participants.find(p => p.id !== blockerId);
    if (!blockedUser) throw new BadRequestException('No other user to block');

    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId: blockedUser.id } },
        create: { blockerId, blockedId: blockedUser.id, conversationId, reason },
        update: { conversationId, reason },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { isReadOnly: true } // Usually blocking freezes the chat
      })
    ]);
    return { success: true };
  }

  async reportUser(conversationId: string, reporterId: string, reason: string) {
    const conversation = await this.requireConversation(conversationId, reporterId);
    const reportedUser = conversation.participants.find(p => p.id !== reporterId);
    if (!reportedUser) throw new BadRequestException('No other user to report');

    await this.prisma.auditLog.create({
      data: {
        actorId: reporterId,
        action: 'REPORT_USER',
        entityType: 'User',
        entityId: reportedUser.id,
        before: { conversationId },
        after: { reason }
      }
    });
    return { success: true };
  }
}
