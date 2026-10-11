import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SendMessageDto } from './dto/send-message.dto';

describe('ChatService', () => {
  let service: ChatService;
  const mockPrisma: any = {
    conversation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    message: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), groupBy: jest.fn() },
    messageRead: { createMany: jest.fn() },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };

  const notifications = { notify: jest.fn() };
  const storage = { consume: jest.fn(), signedUrlForKey: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService, 
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: notifications },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(ChatService);
  });
  afterEach(() => jest.resetAllMocks());
  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    notifications.notify.mockResolvedValue(1);
    storage.signedUrlForKey.mockImplementation(async (k: string) => `https://signed/${k}`);
  });

  const thread = { id: 'c1', participants: [{ id: 'a' }, { id: 'b' }], isReadOnly: false };

  it('non-participants get 404 for messages', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.getMessages('c1', 'intruder')).rejects.toThrow(NotFoundException);
    expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
  });

  it('thread lookup is scoped to the requesting participant', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(thread);
    mockPrisma.message.findMany.mockResolvedValue([]);
    await service.getMessages('c1', 'a');
    expect(mockPrisma.conversation.findFirst.mock.calls[0][0].where).toEqual({
      id: 'c1',
      participants: { some: { id: 'a' } },
    });
  });

  it('cannot send into a conversation you are not in', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.sendMessage('x', { threadId: 'c1', text: 'hi' })).rejects.toThrow(NotFoundException);
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it('cannot send into a read-only conversation', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ ...thread, isReadOnly: true });
    await expect(service.sendMessage('a', { threadId: 'c1', text: 'hi' })).rejects.toThrow(BadRequestException);
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it('mark-read creates messageRead records for unread messages sent by others', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(thread);
    mockPrisma.message.findMany.mockResolvedValue([{ id: 'm1' }]);
    await service.markAsRead('c1', 'a');
    
    expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'c1',
        senderId: { not: 'a' },
        reads: { none: { userId: 'a' } }
      },
      select: { id: true }
    });
    
    expect(mockPrisma.messageRead.createMany).toHaveBeenCalledWith({
      data: [{ messageId: 'm1', userId: 'a' }],
      skipDuplicates: true
    });
  });

  it('can block a user in the conversation', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(thread);
    mockPrisma.block = { upsert: jest.fn() };
    await service.blockUser('c1', 'a', 'spam');
    expect(mockPrisma.block.upsert).toHaveBeenCalled();
    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { isReadOnly: true }
    });
  });

  it('can report a user in the conversation', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(thread);
    mockPrisma.auditLog = { create: jest.fn() };
    await service.reportUser('c1', 'a', 'rude');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'a',
        action: 'REPORT_USER',
        entityId: 'b',
        after: { reason: 'rude' }
      })
    });
  });

  describe('security (doc 27 F1)', () => {
    const named = { id: 'c1', isReadOnly: false, participants: [{ id: 'a', name: 'Ali Khan' }, { id: 'b', name: 'Bilal' }] };

    it('clients cannot mark a message as a system message (unknown fields are rejected)', () => {
      const errors = validateSync(plainToInstance(SendMessageDto, { text: 'Pay advance to 0300', isSystem: true }), { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.map((e) => e.property)).toContain('isSystem');
      const keyErrors = validateSync(plainToInstance(SendMessageDto, { imageKey: 'verification/someone-else-id.jpg' }), { whitelist: true, forbidNonWhitelisted: true });
      expect(keyErrors.map((e) => e.property)).toContain('imageKey');
    });

    it('a sent message is never a system message, and the push never contains the text', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(named);
      mockPrisma.message.create.mockImplementation(async ({ data }: any) => ({ id: 'm1', ...data, sender: { id: 'a', name: 'Ali Khan' }, reads: [] }));
      await service.sendMessage('a', { threadId: 'c1', text: 'my secret door code is 4411' });
      expect(mockPrisma.message.create.mock.calls[0][0].data).toMatchObject({ senderId: 'a', isSystem: false });
      const push = notifications.notify.mock.calls[0][0];
      expect(push).toMatchObject({ type: 'chat.message', userIds: ['b'], params: { sender: 'Ali' }, data: { url: '/thread/c1' } });
      expect(JSON.stringify(push)).not.toContain('4411');
    });

    it('an image must be the sender\'s own CHAT_PHOTO upload; links are signed, keys never returned', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(named);
      storage.consume.mockResolvedValue(['chat-photos/x.jpg']);
      mockPrisma.message.create.mockImplementation(async ({ data }: any) => ({ id: 'm2', ...data, sender: null, reads: [] }));
      const out: any = await service.sendMessage('a', { threadId: 'c1', imageUploadId: 'up9' });
      expect(storage.consume).toHaveBeenCalledWith('a', ['up9'], 'CHAT_PHOTO', mockPrisma);
      expect(out.imageUrl).toBe('https://signed/chat-photos/x.jpg');
      expect(out.imageKey).toBeUndefined();
    });

    it('an empty message is refused', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(named);
      await expect(service.sendMessage('a', { threadId: 'c1', text: '   ' })).rejects.toThrow(BadRequestException);
    });
  });
});
