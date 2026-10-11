import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

describe('ChatService', () => {
  const prisma: any = {
    conversation: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    message: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), groupBy: jest.fn() },
    messageRead: { createMany: jest.fn() },
    incident: { create: jest.fn() },
    block: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const notifications = { notify: jest.fn() };
  const storage = { consume: jest.fn(), signedUrlForKey: jest.fn(async (k: string) => `https://signed/${k}`) };
  const realtime = { emitToUsers: jest.fn() };
  const blocks = { between: jest.fn(), block: jest.fn() };
  const events = { emit: jest.fn() };
  const audit = { record: jest.fn() };
  const svc = new ChatService(prisma, notifications as any, storage as any, realtime as any, blocks as any, events as any, audit as any);
  const conv = { id: 'c1', isReadOnly: false, closedAt: null, jobRequest: { id: 'j1', title: 'Tap' }, participants: [{ id: 'a', name: 'Ali Khan' }, { id: 'b', name: 'Bilal' }] };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
    prisma.conversation.findFirst.mockResolvedValue(conv);
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockImplementation(async ({ data }: any) => ({ id: 'm1', createdAt: new Date(), ...data, sender: { id: 'a', name: 'Ali Khan' }, reads: [] }));
    blocks.between.mockResolvedValue(false);
    notifications.notify.mockResolvedValue(1);
    storage.signedUrlForKey.mockImplementation(async (k: string) => `https://signed/${k}`);
  });

  it('non-participants get 404, scoped to the requester', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(svc.getMessages('c1', 'intruder')).rejects.toThrow(NotFoundException);
    expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({ id: 'c1', participants: { some: { id: 'intruder' } } });
    await expect(svc.sendMessage('x', { threadId: 'c1', text: 'hi' })).rejects.toThrow(NotFoundException);
  });

  it('a sent message reaches everyone live (other devices too) and the list refreshes', async () => {
    await svc.sendMessage('a', { threadId: 'c1', text: 'hello', clientId: 'cl-1' });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['a', 'b'], 'message.created', expect.objectContaining({ id: 'm1', clientId: 'cl-1', imageUrl: null }));
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['a', 'b'], 'conversation.updated', { conversationId: 'c1' });
  });

  it('the push says who wrote, never what, and links to the thread', async () => {
    await svc.sendMessage('a', { threadId: 'c1', text: 'gate code 4411' });
    const push = notifications.notify.mock.calls[0][0];
    expect(push).toMatchObject({ type: 'chat.message', userIds: ['b'], params: { sender: 'Ali' }, data: { url: '/thread/c1' } });
    expect(JSON.stringify(push)).not.toContain('4411');
  });

  it('a resend with the same clientId returns the first message (outbox retries)', async () => {
    prisma.message.findUnique.mockResolvedValue({ id: 'm0', text: 'hi', imageKey: null, reads: [] });
    await expect(svc.sendMessage('a', { threadId: 'c1', text: 'hi', clientId: 'cl-1' })).resolves.toMatchObject({ id: 'm0' });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('blocked: no messages either way', async () => {
    blocks.between.mockResolvedValue(true);
    await expect(svc.sendMessage('a', { threadId: 'c1', text: 'hi' })).rejects.toThrow(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('closed or empty: refused', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ ...conv, isReadOnly: true });
    await expect(svc.sendMessage('a', { threadId: 'c1', text: 'hi' })).rejects.toThrow(BadRequestException);
    prisma.conversation.findFirst.mockResolvedValue(conv);
    await expect(svc.sendMessage('a', { threadId: 'c1', text: '  ' })).rejects.toThrow(BadRequestException);
  });

  it('contact sharing: sent as written, flagged, and only the sender gets the reminder', async () => {
    const out: any = await svc.sendMessage('a', { threadId: 'c1', text: 'call me on 0300 1234567' });
    expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ isFlagged: true, isSystem: false, text: 'call me on 0300 1234567' });
    expect(prisma.message.create).toHaveBeenCalledTimes(1); // no system line both people see
    expect(out).toMatchObject({ warning: 'CONTACT_INFO', contactKinds: ['phone'] });
    const live = realtime.emitToUsers.mock.calls.find((c: any[]) => c[1] === 'message.created')[2];
    expect(live.warning).toBeUndefined();
    const plain: any = await svc.sendMessage('a', { threadId: 'c1', text: 'It costs Rs 1,500.00' });
    expect(plain.warning).toBeUndefined();
  });

  it('images: the sender\'s own CHAT_PHOTO upload; signed link out, never a key', async () => {
    storage.consume.mockResolvedValue(['chat-photos/x.jpg']);
    const out: any = await svc.sendMessage('a', { threadId: 'c1', imageUploadId: 'up9' });
    expect(storage.consume).toHaveBeenCalledWith('a', ['up9'], 'CHAT_PHOTO', prisma);
    expect(out.imageUrl).toBe('https://signed/chat-photos/x.jpg');
    expect(out.imageKey).toBeUndefined();
  });

  it('reading sends read ticks to the sender, live', async () => {
    prisma.message.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    await svc.markAsRead('c1', 'b');
    expect(prisma.messageRead.createMany.mock.calls[0][0].data.map((d: any) => d.messageId)).toEqual(['m1', 'm2']);
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['a'], 'message.read', expect.objectContaining({ conversationId: 'c1', userId: 'b', messageIds: ['m1', 'm2'] }));
  });

  it('typing is throttled to one signal per 3 s per person and chat', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ participants: [{ id: 'a' }, { id: 'b' }] });
    await svc.typing('a', 'c9');
    await svc.typing('a', 'c9');
    expect(realtime.emitToUsers).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['b'], 'chat.typing', { conversationId: 'c9', userId: 'a' });
  });

  it('block applies everywhere (through BlocksService) and is audited', async () => {
    await svc.blockUser('c1', 'a', 'spam');
    expect(blocks.block).toHaveBeenCalledWith('a', 'b', 'spam', 'c1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.blocked', entityId: 'b' }));
  });

  it('a report becomes a safety incident for staff', async () => {
    prisma.incident.create.mockResolvedValue({ id: 'i1', type: 'REPORT_USER' });
    await expect(svc.reportUser('c1', 'a', 'SCAM', 'asked for an advance')).resolves.toMatchObject({ incidentId: 'i1' });
    expect(prisma.incident.create.mock.calls[0][0].data).toMatchObject({ reporterId: 'a', targetId: 'b', jobRequestId: 'j1', type: 'REPORT_USER' });
    expect(events.emit).toHaveBeenCalledWith('admin.incident_reported', { incidentId: 'i1', type: 'REPORT_USER' });
  });

  it('clients cannot send isSystem or a raw image key', () => {
    const v = (o: object) => validateSync(plainToInstance(SendMessageDto, o), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
    expect(v({ text: 'x', isSystem: true })).toContain('isSystem');
    expect(v({ imageKey: 'verification/a.jpg' })).toContain('imageKey');
  });
});
