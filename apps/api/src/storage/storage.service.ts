import { StaffAccessService } from '../common/access/staff-access.service';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, UploadPurpose } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  EXTENSIONS, STORAGE_DRIVER, StorageDriver, UPLOAD_POLICIES, canonicalMime, sniffMime,
} from './storage.types';

export interface CreateUploadInput {
  purpose: UploadPurpose;
  mime: string;
  size: number;
}

@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
    private readonly staff: StaffAccessService,
  ) {}

  /** Public URL for a stored key. Used to expose avatars/portfolio photos. */
  publicUrl(key: string): string {
    return this.driver.publicUrl(key);
  }

  /** 1) Client asks for a slot. Nothing is trusted yet: purpose, type and size are validated here. */
  async createUpload(ownerId: string, input: CreateUploadInput) {
    const policy = UPLOAD_POLICIES[input.purpose];
    if (!policy.mimes.includes(input.mime)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: input.purpose === 'JOB_AUDIO' ? 'That recording format is not supported.' : 'Please choose a JPG, PNG or WebP photo.',
      });
    }
    if (!Number.isInteger(input.size) || input.size < 1) throw new BadRequestException('Invalid file size');
    if (input.size > policy.maxBytes) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `That photo is too large. The limit is ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`,
      });
    }

    const key = `${input.purpose.toLowerCase()}/${ownerId}/${randomUUID()}.${EXTENSIONS[input.mime]}`;
    const upload = await this.prisma.upload.create({
      data: { ownerId, purpose: input.purpose, key, mime: canonicalMime(input.mime), size: input.size },
    });
    const target = await this.driver.createUploadTarget({
      key, mime: input.mime, size: input.size, visibility: policy.visibility,
    });
    return { id: upload.id, upload: target };
  }

  /** 2) After the bytes are uploaded: check they exist, fit the declared size, and really are the image type claimed. */
  async complete(ownerId: string, uploadId: string) {
    const upload = await this.prisma.upload.findFirst({ where: { id: uploadId, ownerId } });
    if (!upload) throw new NotFoundException('Upload not found');
    if (upload.status === 'READY') return this.view(upload);
    if (upload.status === 'REJECTED') throw new ConflictException('This upload was rejected. Please try again.');

    const reject = async (message: string, code: string) => {
      await this.prisma.upload.update({ where: { id: upload.id }, data: { status: 'REJECTED' } });
      await this.driver.remove(upload.key).catch(() => undefined);
      throw new BadRequestException({ code, message });
    };

    const stat = await this.driver.stat(upload.key);
    if (!stat) throw new BadRequestException({ code: 'UPLOAD_MISSING', message: 'The photo did not arrive. Please try again.' });
    if (stat.size > upload.size || stat.size < 1) {
      return reject('The photo size did not match. Please try again.', 'UPLOAD_SIZE_MISMATCH');
    }

    const actual = sniffMime(await this.driver.readHead(upload.key, 16));
    if (!actual || actual !== canonicalMime(upload.mime)) {
      return upload.purpose === 'JOB_AUDIO'
        ? reject('That file is not a valid recording.', 'UPLOAD_NOT_AUDIO')
        : reject('That file is not a valid photo.', 'UPLOAD_NOT_AN_IMAGE');
    }

    const ready = await this.prisma.upload.update({ where: { id: upload.id }, data: { status: 'READY', readyAt: new Date() } });
    return this.view(ready);
  }

  /**
   * Attach ready uploads to something (avatar, portfolio item, verification case). Each upload can
   * be attached once, only by its owner, and only for the purpose it was created for.
   * Pass `tx` so attaching and creating the parent happen atomically.
   */
  async consume(ownerId: string, uploadIds: string[], purpose: UploadPurpose, tx?: Prisma.TransactionClient): Promise<string[]> {
    return (await this.consumeFiles(ownerId, uploadIds, purpose, tx)).map((f) => f.key);
  }

  /**
   * The one way to attach a file to anything: the caller's own, finished (type-checked) upload of
   * the right purpose, used once. Returns the private key and the verified MIME type. Clients
   * never send storage keys (doc 27 F1.3).
   */
  async consumeFiles(ownerId: string, uploadIds: string[], purpose: UploadPurpose, tx?: Prisma.TransactionClient): Promise<{ key: string; mime: string }[]> {
    const db = tx ?? this.prisma;
    const ids = [...new Set(uploadIds)];
    const rows = await db.upload.findMany({ where: { id: { in: ids }, ownerId, purpose, status: 'READY', usedAt: null } });
    if (rows.length !== ids.length) {
      throw new BadRequestException({ code: 'INVALID_UPLOAD', message: 'One of the photos is missing or was already used. Please upload it again.' });
    }
    const claimed = await db.upload.updateMany({
      where: { id: { in: ids }, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== ids.length) {
      throw new ConflictException({ code: 'UPLOAD_IN_USE', message: 'That photo was just used elsewhere.' });
    }
    const byId = new Map(rows.map((r) => [r.id, { key: r.key, mime: r.mime }]));
    return ids.map((id) => byId.get(id)!);
  }

  /** Short-lived link to a private document; only its owner or an admin may ask. */
  async signedUrlFor(user: { id: string; type: string }, uploadId: string) {
    const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.status !== 'READY' || (upload.ownerId !== user.id && user.type !== 'admin')) {
      throw new NotFoundException('Upload not found');
    }
    // Staff: identity documents need documents.view; other private files a case-handling permission.
    if (upload.ownerId !== user.id) {
      if (upload.purpose === 'VERIFICATION') await this.staff.assert(user, 'documents.view');
      else await this.staff.assert(user, 'jobs.read', 'disputes.read', 'safety.read');
    }
    return { url: await this.driver.signedGetUrl(upload.key, 300), expiresInSeconds: 300 };
  }

  /** Bytes + mime of the caller's own ready upload (used to send a photo/voice note to the AI). */
  async readOwn(ownerId: string, uploadId: string, purposes: UploadPurpose[]) {
    const upload = await this.prisma.upload.findFirst({
      where: { id: uploadId, ownerId, status: 'READY', purpose: { in: purposes } },
    });
    if (!upload) throw new BadRequestException({ code: 'INVALID_UPLOAD', message: 'That photo or recording was not found. Please add it again.' });
    return { bytes: await this.driver.read(upload.key), mime: upload.mime, key: upload.key, purpose: upload.purpose };
  }

  /**
   * Erase this person's stored files of the given kinds (account deletion: ID photos, selfie, avatar,
   * portfolio). Returns how many were removed. A file that is already gone is not an error.
   */
  async deleteOwned(ownerId: string, purposes: UploadPurpose[]): Promise<number> {
    const uploads = await this.prisma.upload.findMany({ where: { ownerId, purpose: { in: purposes } }, select: { id: true, key: true } });
    for (const u of uploads) await this.driver.remove(u.key).catch(() => undefined);
    await this.prisma.upload.deleteMany({ where: { id: { in: uploads.map((u) => u.id) } } });
    return uploads.length;
  }

  async signedUrlForKey(key: string, ttlSeconds = 300): Promise<string> {
    return this.driver.signedGetUrl(key, ttlSeconds);
  }

  private view(u: { id: string; purpose: UploadPurpose; key: string; status: string }) {
    const policy = UPLOAD_POLICIES[u.purpose];
    return {
      id: u.id,
      status: u.status,
      url: u.status === 'READY' && policy.visibility === 'public' ? this.driver.publicUrl(u.key) : null,
    };
  }
}
