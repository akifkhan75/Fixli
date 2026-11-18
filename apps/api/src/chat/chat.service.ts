import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notifications: NotificationService,
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
      items: items.map(item => ({
        ...item,
        unreadCount: unreadMap.get(item.id) || 0
      })),
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
      include: { 
        sender: { select: { id: true, name: true } },
        reads: { select: { userId: true, readAt: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    let nextCursor: string | null = null;
    if (items.length > take) {
      const nextItem = items.pop();
      nextCursor = nextItem!.id;
    }

    return { items, nextCursor };
  }

  async sendMessage(
    senderId: string,
    dto: { threadId: string; text?: string; isSystem?: boolean; imageKey?: string; clientId?: string }
  ) {
    const conversation = await this.requireConversation(dto.threadId, senderId);
    
    if (conversation.isReadOnly) {
      throw new BadRequestException('Conversation is read-only');
    }

    // Check idempotency
    if (dto.clientId) {
      const existing = await this.prisma.message.findUnique({
        where: { conversationId_clientId: { conversationId: dto.threadId, clientId: dto.clientId } },
        include: { sender: { select: { id: true, name: true } } }
      });
      if (existing) return existing;
    }

    const hasContactInfo = dto.text && !dto.isSystem && (
      /[\d\s\-\+\(\)]{8,}/.test(dto.text) || // basic phone heuristic
      /https?:\/\/[^\s]+/.test(dto.text) ||
      /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]\b/i.test(dto.text)
    );

    const txOps: any[] = [
      this.prisma.message.create({
        data: { 
          conversationId: dto.threadId, 
          senderId, 
          text: dto.text,
          isSystem: dto.isSystem ?? false,
          imageKey: dto.imageKey,
          clientId: dto.clientId
        },
        include: { sender: { select: { id: true, name: true } } },
      }),
      this.prisma.conversation.update({
        where: { id: dto.threadId },
        data: { lastMessageAt: new Date() },
      }),
    ];

    if (hasContactInfo) {
      txOps.push(this.prisma.message.create({
        data: {
          conversationId: dto.threadId,
          isSystem: true,
          text: 'Please keep communication on Fixli. Sharing contact info or links can be unsafe.'
        }
      }));
    }

    const [message] = await this.prisma.$transaction(txOps);
    
    // Notify other participants
    const otherParticipants = conversation.participants.filter(p => p.id !== senderId);
    if (otherParticipants.length > 0 && !dto.isSystem && dto.text) {
      const sender = conversation.participants.find(p => p.id === senderId);
      this.notifications.notify({
        type: 'chat.message',
        userIds: otherParticipants.map(p => p.id),
        eventKey: `message:${message.id}`,
        params: { sender: sender?.name ?? 'Someone', text: dto.text },
        data: { url: `/(shared)/chat/${dto.threadId}` },
      });
    }

    return message;
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
