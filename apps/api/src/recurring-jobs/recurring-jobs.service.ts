import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../database/prisma.service';
import { CreateRecurringJobDto } from './dto/recurring-job.dto';

/** The first date after `now` on this schedule. Months keep their day where the month has it. */
export function nextDate(from: Date, frequency: string, now: Date): Date {
  const months = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : frequency === 'YEARLY' ? 12 : 0;
  const at = (n: number) => {
    if (!months) return new Date(from.getTime() + n * 7 * 86_400_000); // WEEKLY (and unknown values)
    const d = new Date(from);
    d.setUTCDate(1);
    d.setUTCMonth(from.getUTCMonth() + n * months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(from.getUTCDate(), last));
    return d;
  };
  let n = 1;
  while (at(n) <= now) n++;
  return at(n);
}

@Injectable()
export class RecurringJobsService {
  private readonly logger = new Logger(RecurringJobsService.name);

  constructor(private readonly prisma: PrismaService, private readonly matching: MatchingService) {}

  private async requireOwnProperty(userId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, userId }, select: { id: true } });
    if (!property) throw new NotFoundException('Property not found');
  }

  async createRecurringJob(userId: string, propertyId: string, dto: CreateRecurringJobDto) {
    await this.requireOwnProperty(userId, propertyId);
    return this.prisma.recurringJob.create({
      data: { ...dto, propertyId, nextExecutionDate: new Date(dto.nextExecutionDate) },
    });
  }

  async getPropertyRecurringJobs(userId: string, propertyId: string) {
    await this.requireOwnProperty(userId, propertyId);
    return this.prisma.recurringJob.findMany({
      where: { propertyId },
      include: { service: true },
      take: 50,
    });
  }

  async cancelRecurringJob(userId: string, id: string) {
    const result = await this.prisma.recurringJob.updateMany({
      where: { id, property: { userId } },
      data: { isActive: false },
    });
    if (result.count === 0) throw new NotFoundException('Recurring job not found');
    return this.prisma.recurringJob.findUnique({ where: { id } });
  }

  /**
   * Create a request for each due schedule and move it to its next date. The request's key names
   * the schedule and the due date, so a retry or a second instance can't create it twice. Missed
   * periods are skipped: one request now, never a backlog.
   */
  async runDue(now = new Date()): Promise<number> {
    let created = 0;
    for (const r of await this.getDueJobs(now)) {
      try {
        const [owner, property] = await Promise.all([
          this.prisma.user.findFirst({ where: { id: r.property.userId, status: 'ACTIVE' }, select: { id: true, name: true } }),
          this.prisma.property.findUniqueOrThrow({ where: { id: r.property.id } }),
        ]);
        if (!owner) {
          await this.prisma.recurringJob.update({ where: { id: r.id }, data: { isActive: false } });
          continue;
        }
        const idempotencyKey = `recurring:${r.id}:${r.nextExecutionDate.toISOString().slice(0, 10)}`;
        const existing = await this.prisma.jobRequest.findUnique({ where: { customerId_idempotencyKey: { customerId: owner.id, idempotencyKey } }, select: { id: true } });
        if (!existing) {
          const job = await this.prisma.jobRequest.create({
            data: {
              customerId: owner.id, customerName: owner.name, idempotencyKey,
              serviceId: r.serviceId, categoryId: r.service.categoryId, title: r.service.name, description: r.notes?.trim() || r.service.name,
              status: 'MATCHES_FOUND', location: [property.streetAddress, property.city].join(', '), city: property.city,
              whenOption: 'SCHEDULED', scheduledFrom: now, scheduledTo: new Date(now.getTime() + 24 * 3600_000),
              events: { create: { type: 'REQUEST_SENT', actorId: owner.id } },
            },
            select: { id: true },
          });
          created++;
          await this.matching.matchJob(job.id, 1);
        }
        await this.prisma.recurringJob.updateMany({
          where: { id: r.id, nextExecutionDate: r.nextExecutionDate },
          data: { nextExecutionDate: nextDate(r.nextExecutionDate, r.frequency, now) },
        });
      } catch (e) {
        this.logger.error(`Recurring job ${r.id} failed: ${(e as Error).message}`);
      }
    }
    return created;
  }

  getDueJobs(now = new Date()) {
    return this.prisma.recurringJob.findMany({
      where: { isActive: true, nextExecutionDate: { lte: now } },
      include: { property: { select: { id: true, userId: true } }, service: true },
      take: 500,
    });
  }
}
