import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

/**
 * "Only one runner at a time" for background jobs, across all API instances, via a lease row
 * (SchedulerLease). A Postgres session advisory lock doesn't work behind Prisma's connection pool:
 * lock and unlock can land on different connections and the lock is never released.
 */
@Injectable()
export class LeaseService {
  private readonly holder = randomUUID();
  private readonly running = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Runs `fn` if this process can take the named lease; returns null if someone else holds it. */
  async runExclusive<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    // A slow run must not overlap the next tick in this process either.
    if (this.running.has(name)) return null;
    this.running.add(name);
    try {
      if (!(await this.acquire(name, ttlMs))) return null;
      try {
        return await fn();
      } finally {
        await this.prisma.$executeRaw`DELETE FROM "SchedulerLease" WHERE "name" = ${name} AND "holder" = ${this.holder}`;
      }
    } finally {
      this.running.delete(name);
    }
  }

  /** Take the lease if it's free or lapsed. Atomic: two instances can't both win. */
  private async acquire(name: string, ttlMs: number): Promise<boolean> {
    const at = new Date();
    const rows = await this.prisma.$queryRaw<{ holder: string }[]>`
      INSERT INTO "SchedulerLease" ("name", "holder", "expiresAt")
      VALUES (${name}, ${this.holder}, ${new Date(at.getTime() + ttlMs)})
      ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "SchedulerLease"."expiresAt" < ${at} OR "SchedulerLease"."holder" = EXCLUDED."holder"
      RETURNING "holder"`;
    return rows.length > 0;
  }
}
