import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Blocking works across the whole product (doc 26 7.5): two people who blocked each other (in
 * either direction) are never matched, can't send each other prices or direct requests, and
 * can't message each other.
 */
@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async between(a: string, b: string): Promise<boolean> {
    const n = await this.prisma.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
    return n > 0;
  }

  /** SQL fragment for matching: no block either way between the worker row `w` and this customer. */
  static notBlockedSql(customerId: string) {
    return Prisma.sql`NOT EXISTS (SELECT 1 FROM "Block" b WHERE (b."blockerId" = w.id AND b."blockedId" = ${customerId}) OR (b."blockerId" = ${customerId} AND b."blockedId" = w.id))`;
  }

  async block(blockerId: string, blockedId: string, reason?: string, conversationId?: string) {
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId, reason, conversationId },
      update: { reason, conversationId },
    });
  }

  list(blockerId: string) {
    return this.prisma.block.findMany({
      where: { blockerId },
      select: { blockedId: true, createdAt: true, blocked: { select: { name: true, profileImageUrl: true, type: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    return { success: true };
  }
}
