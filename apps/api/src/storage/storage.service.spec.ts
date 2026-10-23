import { BadRequestException, ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { sniffImageMime } from './storage.types';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 0, 0, 0]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'binary');

describe('sniffImageMime', () => {
  it('recognises real images by their bytes', () => {
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))).toBe('image/webp');
  });
  it('rejects anything else, including executables and HTML', () => {
    expect(sniffImageMime(EXE)).toBeNull();
    expect(sniffImageMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('StorageService', () => {
  const prisma: any = { upload: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() } };
  const driver: any = {
    createUploadTarget: jest.fn().mockResolvedValue({ url: 'http://x/put', method: 'PUT', headers: {} }),
    stat: jest.fn(), readHead: jest.fn(), publicUrl: (k: string) => `http://cdn/${k}`, signedGetUrl: jest.fn().mockResolvedValue('http://signed'), remove: jest.fn().mockResolvedValue(undefined),
  };
  const staff = { assert: jest.fn() };
  const svc = new StorageService(prisma, driver, staff as any);
  afterEach(() => jest.clearAllMocks());

  describe('createUpload', () => {
    it('refuses non-image types and oversize files before any slot is issued', async () => {
      await expect(svc.createUpload('u1', { purpose: 'AVATAR', mime: 'application/pdf', size: 1000 })).rejects.toMatchObject({ response: { code: 'UNSUPPORTED_FILE_TYPE' } });
      await expect(svc.createUpload('u1', { purpose: 'AVATAR', mime: 'image/jpeg', size: 50 * 1024 * 1024 })).rejects.toThrow(PayloadTooLargeException);
      await expect(svc.createUpload('u1', { purpose: 'AVATAR', mime: 'image/jpeg', size: 0 })).rejects.toThrow(BadRequestException);
      expect(prisma.upload.create).not.toHaveBeenCalled();
    });

    it('keys are namespaced by purpose and owner, with a random name (no client-chosen paths)', async () => {
      prisma.upload.create.mockImplementation(async ({ data }: any) => ({ id: 'up1', ...data }));
      await svc.createUpload('user-9', { purpose: 'VERIFICATION', mime: 'image/png', size: 1000 });
      const key = prisma.upload.create.mock.calls[0][0].data.key;
      expect(key).toMatch(/^verification\/user-9\/[0-9a-f-]{36}\.png$/);
      expect(driver.createUploadTarget.mock.calls[0][0].visibility).toBe('private');
    });
  });

  describe('complete', () => {
    const row = { id: 'up1', ownerId: 'u1', purpose: 'AVATAR', key: 'avatar/u1/x.jpg', mime: 'image/jpeg', size: 1000, status: 'PENDING' };

    it("only the owner can complete an upload", async () => {
      prisma.upload.findFirst.mockResolvedValue(null);
      await expect(svc.complete('intruder', 'up1')).rejects.toThrow(NotFoundException);
      expect(prisma.upload.findFirst.mock.calls[0][0].where).toEqual({ id: 'up1', ownerId: 'intruder' });
    });

    it('fails if nothing arrived', async () => {
      prisma.upload.findFirst.mockResolvedValue(row);
      driver.stat.mockResolvedValue(null);
      await expect(svc.complete('u1', 'up1')).rejects.toMatchObject({ response: { code: 'UPLOAD_MISSING' } });
    });

    it('rejects and deletes a file bigger than declared', async () => {
      prisma.upload.findFirst.mockResolvedValue(row);
      driver.stat.mockResolvedValue({ size: 5000 });
      await expect(svc.complete('u1', 'up1')).rejects.toMatchObject({ response: { code: 'UPLOAD_SIZE_MISMATCH' } });
      expect(driver.remove).toHaveBeenCalledWith(row.key);
      expect(prisma.upload.update.mock.calls[0][0].data.status).toBe('REJECTED');
    });

    it('rejects a file that is not really an image, whatever mime was claimed', async () => {
      prisma.upload.findFirst.mockResolvedValue(row);
      driver.stat.mockResolvedValue({ size: 900 });
      driver.readHead.mockResolvedValue(EXE);
      await expect(svc.complete('u1', 'up1')).rejects.toMatchObject({ response: { code: 'UPLOAD_NOT_AN_IMAGE' } });
      expect(driver.remove).toHaveBeenCalled();
    });

    it('rejects an image whose real type differs from the claimed one', async () => {
      prisma.upload.findFirst.mockResolvedValue(row); // claims jpeg
      driver.stat.mockResolvedValue({ size: 900 });
      driver.readHead.mockResolvedValue(PNG);
      await expect(svc.complete('u1', 'up1')).rejects.toMatchObject({ response: { code: 'UPLOAD_NOT_AN_IMAGE' } });
    });

    it('marks a genuine image READY and exposes a URL only for public purposes', async () => {
      prisma.upload.findFirst.mockResolvedValue(row);
      driver.stat.mockResolvedValue({ size: 900 });
      driver.readHead.mockResolvedValue(JPEG);
      prisma.upload.update.mockResolvedValue({ ...row, status: 'READY' });
      expect(await svc.complete('u1', 'up1')).toEqual({ id: 'up1', status: 'READY', url: 'http://cdn/avatar/u1/x.jpg' });

      prisma.upload.findFirst.mockResolvedValue({ ...row, purpose: 'VERIFICATION', key: 'verification/u1/y.jpg' });
      prisma.upload.update.mockResolvedValue({ ...row, purpose: 'VERIFICATION', key: 'verification/u1/y.jpg', status: 'READY' });
      expect((await svc.complete('u1', 'up1')).url).toBeNull();
    });
  });

  describe('consume (attach)', () => {
    it('only the owner\'s READY, unused uploads of the right purpose can be attached', async () => {
      prisma.upload.findMany.mockResolvedValue([]);
      await expect(svc.consume('u1', ['a'], 'AVATAR')).rejects.toMatchObject({ response: { code: 'INVALID_UPLOAD' } });
      expect(prisma.upload.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['a'] }, ownerId: 'u1', purpose: 'AVATAR', status: 'READY', usedAt: null,
      });
    });

    it('an upload cannot be claimed twice, even concurrently', async () => {
      prisma.upload.findMany.mockResolvedValue([{ id: 'a', key: 'k' }]);
      prisma.upload.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.consume('u1', ['a'], 'AVATAR')).rejects.toThrow(ConflictException);
    });

    it('returns keys in the order requested and de-duplicates ids', async () => {
      prisma.upload.findMany.mockResolvedValue([{ id: 'b', key: 'kb' }, { id: 'a', key: 'ka' }]);
      prisma.upload.updateMany.mockResolvedValue({ count: 2 });
      expect(await svc.consume('u1', ['a', 'b', 'a'], 'PORTFOLIO')).toEqual(['ka', 'kb']);
    });
  });

  describe('private documents', () => {
    it('only the owner or an admin can get a signed link', async () => {
      prisma.upload.findUnique.mockResolvedValue({ id: 'up1', ownerId: 'u1', status: 'READY', key: 'verification/u1/y.jpg' });
      await expect(svc.signedUrlFor({ id: 'other', type: 'customer' }, 'up1')).rejects.toThrow(NotFoundException);
      await expect(svc.signedUrlFor({ id: 'u1', type: 'worker' }, 'up1')).resolves.toMatchObject({ url: 'http://signed' });
      await expect(svc.signedUrlFor({ id: 'a1', type: 'admin' }, 'up1')).resolves.toMatchObject({ url: 'http://signed' });
    });
  });
});
