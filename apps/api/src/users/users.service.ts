import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SessionService } from '../auth/session.service';
import { AuditService } from '../common/audit/audit.service';
import { BUSY_STATUSES } from '../jobs/job-state-machine';
import { UpdateMeDto } from './dto/update-me.dto';

const SELECT = {
  id: true, name: true, email: true, phone: true, countryCode: true, locale: true,
  type: true, status: true, profileImageUrl: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({ select: SELECT, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    const { name, locale } = dto;
    await this.prisma.$transaction(async (tx) => {
      let profileImageUrl: string | null | undefined;
      if (dto.avatarUploadId) {
        const [key] = await this.storage.consume(id, [dto.avatarUploadId], 'AVATAR', tx);
        profileImageUrl = key; // stored as a key; turned into a URL on the way out
      } else if (dto.removeAvatar) {
        profileImageUrl = null;
      }
      await tx.user.update({ where: { id }, data: { name: name?.trim(), locale, profileImageUrl } });
    });
    return this.findById(id);
  }

  /**
   * Delete my account (store requirement; doc 27 F3.7, D-F4). Refused while a job is under way or
   * commission is owed. Signs out everywhere, cancels open requests and prices, and anonymises the
   * profile; payments, ledger and audit history are kept (anonymised) for the legal period.
   */
  async deleteMe(id: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, password: true, type: true, status: true, worker: { select: { ledgerBalance: true } } } });
    if (!user || user.status === 'DELETED') throw new NotFoundException('User not found');
    if (!(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException({ code: 'WRONG_PASSWORD', message: 'That password is not right.' });
    }
    const active = await this.prisma.jobRequest.count({
      where: { status: { in: BUSY_STATUSES }, OR: [{ customerId: id }, { assignedWorkerId: id }] },
    });
    if (active) throw new ConflictException({ code: 'ACTIVE_JOB', message: 'Finish or cancel your current job first.' });
    if ((user.worker?.ledgerBalance ?? 0) > 0) {
      throw new ConflictException({ code: 'BALANCE_OWED', message: 'Please settle what you owe Fixli first (see Earnings).' });
    }

    await this.prisma.$transaction(async (tx) => {
      const open = await tx.jobRequest.findMany({ where: { customerId: id, status: { in: ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER'] } }, select: { id: true, status: true } });
      for (const j of open) {
        await tx.jobRequest.update({ where: { id: j.id }, data: { status: 'CANCELLED', cancelReason: 'OTHER', cancelledById: id } });
        await tx.jobEvent.create({ data: { jobRequestId: j.id, actorId: id, type: 'CANCELLED', fromStatus: j.status, toStatus: 'CANCELLED', payload: { by: 'customer', reason: 'ACCOUNT_DELETED' } } });
      }
      await tx.offer.updateMany({ where: { workerId: id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
      await tx.address.deleteMany({ where: { userId: id } });
      await tx.trustedContact.deleteMany({ where: { userId: id } });
      await tx.favoriteWorker.deleteMany({ where: { OR: [{ customerId: id }, { workerId: id }] } });
      if (user.type === 'worker') {
        await tx.portfolioItem.deleteMany({ where: { workerId: id } });
        await tx.worker.update({ where: { id }, data: { isOnline: false, bio: null } });
      }
      await tx.user.update({
        where: { id },
        data: {
          status: 'DELETED', name: 'Deleted user', phone: null, email: null, profileImageUrl: null,
          // Nobody can sign in to it again; the phone number is free to register afresh.
          password: await bcrypt.hash(randomBytes(32).toString('hex'), 4),
        },
      });
    });
    // Signs out every device, drops live connections and forgets push tokens (Phase 6 path).
    await this.sessions.revokeAllExcept(id);
    await this.audit.record({ actorId: id, action: 'user.deleted', entityType: 'User', entityId: id });
    return { success: true };
  }


  async getFavorites(customerId: string) {
    return this.prisma.favoriteWorker.findMany({
      where: { customerId },
      include: {
        worker: {
          select: {
            id: true,
            rating: true,
            user: { select: { name: true, profileImageUrl: true } },
            services: { include: { category: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addFavorite(customerId: string, workerId: string) {
    const worker = await this.prisma.worker.findFirst({ where: { id: workerId, activationStatus: 'ACTIVE', user: { status: 'ACTIVE' } }, select: { id: true } });
    if (!worker) throw new NotFoundException('Professional not found');
    await this.prisma.favoriteWorker.upsert({
      where: { customerId_workerId: { customerId, workerId } },
      create: { customerId, workerId },
      update: {},
    });
    return { success: true };
  }

  async removeFavorite(customerId: string, workerId: string) {
    await this.prisma.favoriteWorker.deleteMany({
      where: { customerId, workerId },
    });
    return { success: true };
  }
}
