import { StorageService } from '../storage/storage.service';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateChangeOrderDto } from './dto/change-order.dto';

@Injectable()
export class ChangeOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async create(workerId: string, dto: CreateChangeOrderDto) {
    const job = await this.access.requireAssignedWorker(dto.jobRequestId, workerId);
    if (!['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'].includes(job.status)) {
      throw new ConflictException('Extra work can only be requested on an active job');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const mediaKeys = dto.photoUploadIds?.length ? await this.storage.consume(workerId, dto.photoUploadIds, 'JOB_PHOTO', tx) : [];
      return tx.changeOrder.create({
        data: {
          jobRequestId: dto.jobRequestId,
          reason: dto.reason,
          addedScope: dto.addedScope,
          revisedPrice: dto.revisedPrice,
          currency: dto.currency?.toUpperCase() ?? 'USD',
          mediaKeys,
          status: 'PENDING',
        },
      });
    });
    return this.present(created);
  }

  /** Photos go out as short-lived signed links; keys stay on the server. */
  private async present<T extends { mediaKeys: string[] }>(co: T) {
    const { mediaKeys, ...rest } = co;
    return { ...rest, photos: await Promise.all(mediaKeys.map((k) => this.storage.signedUrlForKey(k, 600))) };
  }

  async findByJob(jobId: string, user: { id: string; type: string }) {
    await this.access.requireParticipant(jobId, user);
    const rows = await this.prisma.changeOrder.findMany({
      where: { jobRequestId: jobId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Promise.all(rows.map((r) => this.present(r)));
  }

  async updateStatus(id: string, customerId: string, status: 'APPROVED' | 'REJECTED') {
    const result = await this.prisma.changeOrder.updateMany({
      where: { id, status: 'PENDING', jobRequest: { customerId } },
      data: { status },
    });
    if (result.count === 0) {
      const co = await this.prisma.changeOrder.findFirst({
        where: { id, jobRequest: { customerId } },
        select: { id: true },
      });
      if (!co) throw new NotFoundException('Change order not found');
      throw new ConflictException('This change order has already been decided');
    }
    await this.audit.record({
      actorId: customerId,
      action: `change_order.${status.toLowerCase()}`,
      entityType: 'ChangeOrder',
      entityId: id,
    });
    return this.present(await this.prisma.changeOrder.findUniqueOrThrow({ where: { id } }));
  }
}
