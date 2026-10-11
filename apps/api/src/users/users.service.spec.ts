import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const tx = { user: { update: jest.fn() } };
  const prisma: any = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const storage = { consume: jest.fn() };
  const svc = new UsersService(prisma, storage as any, { revokeAllExcept: jest.fn() } as any, { record: jest.fn() } as any);
  beforeEach(() => prisma.$transaction.mockImplementation((fn: any) => fn(tx)));
  afterEach(() => jest.resetAllMocks());

  it('never selects the password hash', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await svc.findById('u1');
    expect(JSON.stringify(prisma.user.findUnique.mock.calls[0][0].select)).not.toMatch(/password|failedLogin|lockout/);
  });

  it('404 for a missing user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.findById('x')).rejects.toThrow(NotFoundException);
  });

  describe('updateMe', () => {
    beforeEach(() => prisma.user.findUnique.mockResolvedValue({ id: 'u1' }));

    it('attaches a READY avatar upload that the user owns, storing its key', async () => {
      storage.consume.mockResolvedValue(['avatar/u1/k.jpg']);
      await svc.updateMe('u1', { avatarUploadId: 'up1', name: '  Ahmed  ' });
      expect(storage.consume).toHaveBeenCalledWith('u1', ['up1'], 'AVATAR', tx);
      expect(tx.user.update.mock.calls[0][0]).toEqual({
        where: { id: 'u1' },
        data: { name: 'Ahmed', locale: undefined, profileImageUrl: 'avatar/u1/k.jpg' },
      });
    });

    it('can remove the avatar', async () => {
      await svc.updateMe('u1', { removeAvatar: true });
      expect(tx.user.update.mock.calls[0][0].data.profileImageUrl).toBeNull();
      expect(storage.consume).not.toHaveBeenCalled();
    });

    it('only name, locale and avatar can change: not phone, email, type or status', async () => {
      await svc.updateMe('u1', { name: 'A B', phone: '+9200', type: 'admin', status: 'ACTIVE' } as any);
      expect(Object.keys(tx.user.update.mock.calls[0][0].data).sort()).toEqual(['locale', 'name', 'profileImageUrl']);
    });
  });
});
