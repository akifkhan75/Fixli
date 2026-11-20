import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local.driver';

const KEY = 'avatar/user123/0f8fad5b-d9cb-469f-a165-70867728950e.png';
const DOC = 'verification/user123/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
const res = () => { const r: any = { headers: {} as any, setHeader: (k: string, v: string) => { r.headers[k] = v; }, type: jest.fn(), on: jest.fn(), once: jest.fn(), emit: jest.fn(), write: jest.fn(), end: jest.fn() }; return r; };

describe('FilesController (local driver)', () => {
  let dir: string; let driver: LocalStorageDriver; let c: FilesController;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'fixli-files-')); driver = new LocalStorageDriver(dir, 'http://api/api', 's'); c = new FilesController(driver); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const link = async (key: string, size: number) => {
    const u = new URL((await driver.createUploadTarget({ key, mime: 'image/png', size })).url);
    return { exp: u.searchParams.get('exp')!, sig: u.searchParams.get('sig')! };
  };

  it('404s for every route when the storage is not local', async () => {
    const other = new FilesController({} as any);
    await expect(other.getPrivate(KEY, '1', 'x', res())).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('upload', () => {
    it('rejects a bad signature, and a bad declared size', async () => {
      await expect(c.upload(KEY, '9999999999', '10', 'nope', Readable.from([]) as any)).rejects.toBeInstanceOf(ForbiddenException);
      const { exp, sig } = await link(KEY, 0);
      await expect(c.upload(KEY, exp, '0', sig, Readable.from([]) as any)).rejects.toBeInstanceOf(BadRequestException);
    });
    it('stores a valid upload and refuses one bigger than declared', async () => {
      const ok = await link(KEY, 5);
      await expect(c.upload(KEY, ok.exp, '5', ok.sig, Readable.from([Buffer.from('abc')]) as any)).resolves.toEqual({ ok: true });
      expect(await driver.stat(KEY)).toEqual({ size: 3 });
      const big = await link(DOC, 2);
      await expect(c.upload(DOC, big.exp, '2', big.sig, Readable.from([Buffer.from('abcdef')]) as any)).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
  });

  describe('getPublic', () => {
    it('serves avatars and portfolio, never identity documents, and 404s unknown files', async () => {
      await expect(c.getPublic(DOC, res())).rejects.toBeInstanceOf(NotFoundException);
      await expect(c.getPublic('../etc/passwd', res())).rejects.toBeInstanceOf(NotFoundException);
      await expect(c.getPublic(KEY, res())).rejects.toBeInstanceOf(NotFoundException); // not uploaded yet
      await driver.write(KEY, Readable.from([Buffer.from('png-bytes')]) as any, 100);
      const r = res();
      const pipe = jest.spyOn(driver, 'stream').mockReturnValue({ pipe: jest.fn() } as any);
      await c.getPublic(KEY, r);
      expect(r.headers['Cache-Control']).toContain('immutable');
      expect(r.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(r.type).toHaveBeenCalledWith('image/png');
      pipe.mockRestore();
    });
  });

  describe('getPrivate', () => {
    it('requires a valid signed link', async () => {
      await expect(c.getPrivate(DOC, '9999999999', 'bad', res())).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('serves with no-store once signed, 404 when the file is missing', async () => {
      const url = new URL(await driver.signedGetUrl(DOC, 60));
      const [key, exp, sig] = ['key', 'exp', 'sig'].map((n) => url.searchParams.get(n)!);
      await expect(c.getPrivate(key, exp, sig, res())).rejects.toBeInstanceOf(NotFoundException);
      await driver.write(DOC, Readable.from([Buffer.from('x')]) as any, 10);
      const r = res();
      jest.spyOn(driver, 'stream').mockReturnValue({ pipe: jest.fn() } as any);
      await c.getPrivate(key, exp, sig, r);
      expect(r.headers['Cache-Control']).toBe('private, no-store');
      expect(r.type).toHaveBeenCalledWith('image/jpeg');
    });
  });
});
