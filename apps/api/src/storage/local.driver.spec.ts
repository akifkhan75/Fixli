import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { LocalStorageDriver, SAFE_KEY } from './local.driver';

const KEY = 'avatar/user123/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
const chunks = (...parts: string[]) => Readable.from(parts.map((p) => Buffer.from(p))) as unknown as AsyncIterable<Buffer>;

describe('LocalStorageDriver', () => {
  let dir: string;
  let d: LocalStorageDriver;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'fixli-store-')); d = new LocalStorageDriver(dir, 'http://api/api', 'secret'); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('only accepts generated-looking keys (no traversal)', () => {
    expect(SAFE_KEY.test(KEY)).toBe(true);
    for (const bad of ['../etc/passwd', 'avatar/../../x.jpg', 'avatar/u/x.exe', '/abs/path.jpg', 'avatar/u/short.jpg']) {
      expect(SAFE_KEY.test(bad)).toBe(false);
      expect(() => d.pathFor(bad)).toThrow('Invalid storage key');
    }
  });

  it('signs upload links that verify only for the same key, size and time', async () => {
    const t = await d.createUploadTarget({ key: KEY, mime: 'image/jpeg', size: 1000 });
    expect(t).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });
    const u = new URL(t.url);
    const q = (n: string) => u.searchParams.get(n)!;
    expect(d.verify('put', q('key'), Number(q('exp')), q('sig'), '1000')).toBe(true);
    expect(d.verify('put', q('key'), Number(q('exp')), q('sig'), '999999')).toBe(false); // different size
    expect(d.verify('get', q('key'), Number(q('exp')), q('sig'), '1000')).toBe(false); // different purpose
    expect(d.verify('put', q('key'), Number(q('exp')), 'x'.repeat(64), '1000')).toBe(false);
    expect(d.verify('put', q('key'), Number(q('exp')), 'short', '1000')).toBe(false);
    expect(d.verify('put', q('key'), Math.floor(Date.now() / 1000) - 5, q('sig'), '1000')).toBe(false); // expired
    expect(d.verify('put', 'avatar/../x.jpg', Number(q('exp')), q('sig'), '1000')).toBe(false);
    expect(d.verify('put', q('key'), NaN, q('sig'), '1000')).toBe(false);
  });

  it('writes, stats, reads, streams and removes', async () => {
    expect(await d.stat(KEY)).toBeNull();
    expect(await d.write(KEY, chunks('hello ', 'world'), 100)).toBe(11);
    expect(await d.stat(KEY)).toEqual({ size: 11 });
    expect((await d.read(KEY)).toString()).toBe('hello world');
    expect((await d.readHead(KEY, 5)).toString()).toBe('hello');
    expect((await d.readHead(KEY, 500)).length).toBe(11);
    const out: Buffer[] = [];
    for await (const c of d.stream(KEY)) out.push(c as Buffer);
    expect(Buffer.concat(out).toString()).toBe('hello world');
    await d.remove(KEY);
    expect(await d.stat(KEY)).toBeNull();
    await expect(d.remove(KEY)).resolves.toBeUndefined();
  });

  it('refuses and cleans up a file bigger than declared', async () => {
    await expect(d.write(KEY, chunks('12345', '67890'), 6)).rejects.toBeInstanceOf(RangeError);
    expect(await d.stat(KEY)).toBeNull();
  });

  it('builds public and signed private URLs', async () => {
    expect(d.publicUrl(KEY)).toBe(`http://api/api/files/public/${KEY}`);
    const url = new URL(await d.signedGetUrl(KEY, 300));
    expect(url.pathname).toBe('/api/files/private');
    expect(d.verify('get', url.searchParams.get('key')!, Number(url.searchParams.get('exp')), url.searchParams.get('sig')!)).toBe(true);
  });
});
