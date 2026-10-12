import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CUSTOMER_REVIEW_TAGS, WORKER_REVIEW_TAGS } from './dto/review.dto';
import { PrismaService } from '../database/prisma.service';
import { JobAccessService } from '../common/access/job-access.service';
import { CreateReviewDto } from './dto/review.dto';

const ABUSE = /\b(idiot|stupid|chor|thief|liar|kutta|kutti|bastard|harami|fraud)\b/i;
/** Auto-moderation: a 1-star review with no real explanation, or abusive words, gets a moderator's look. */
export function needsLook(rating: number, comment?: string | null): boolean {
  const c = comment?.trim() ?? '';
  return ABUSE.test(c) || (rating === 1 && c.length < 10);
}

export const REVIEW_REPORT_REASONS = ['ABUSIVE', 'FALSE', 'PERSONAL_INFO', 'NOT_ABOUT_THE_JOB', 'OTHER'] as const;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: JobAccessService,
  ) {}

  async create(user: { id: string; type: string }, dto: CreateReviewDto) {
    if (user.type === 'admin') throw new ForbiddenException('Admins cannot leave reviews');

    const job = await this.access.requireParticipant(dto.jobRequestId, user);
    if (job.status !== 'COMPLETED') {
      throw new ConflictException('You can only review a job after it is completed');
    }
    if (!job.assignedWorkerId) throw new ConflictException('This job had no worker to review');

    // The reviewee is always the other party; the client never chooses who is reviewed.
    const targetId = user.id === job.customerId ? job.assignedWorkerId : job.customerId;
    const allowed: readonly string[] = targetId === job.assignedWorkerId ? WORKER_REVIEW_TAGS : CUSTOMER_REVIEW_TAGS;
    const bad = (dto.tags ?? []).filter((t) => !allowed.includes(t));
    if (bad.length) throw new BadRequestException({ code: 'INVALID_TAGS', message: 'Some tags do not apply to this person.', details: { tags: bad } });

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.review.findUnique({
        where: { jobRequestId_reviewerId: { jobRequestId: job.id, reviewerId: user.id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('You have already reviewed this job');

      const review = await tx.review.create({
        data: {
          jobRequestId: job.id,
          reviewerId: user.id,
          targetId,
          revieweeRole: targetId === job.assignedWorkerId ? 'worker' : 'customer',
          rating: dto.rating,
          comment: dto.comment,
          tags: dto.tags ?? [],
          flagged: needsLook(dto.rating, dto.comment),
        },
      });

      if (targetId === job.assignedWorkerId) {
        // Only published reviews count (moderation can hide one; the rating is then recomputed, F6).
        const agg = await tx.review.aggregate({ where: { targetId, status: 'PUBLISHED', revieweeRole: 'worker' }, _avg: { rating: true } });
        await tx.worker.update({
          where: { id: targetId },
          data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10 },
        });
      }
      return review;
    });
  }

  findByTarget(targetId: string) {
    return this.prisma.review.findMany({
      // Public: published reviews of professionals only. Customers' ratings stay private (doc 22).
      where: { targetId, status: 'PUBLISHED', revieweeRole: 'worker' },
      select: {
        id: true,
        rating: true,
        comment: true,
        tags: true,
        createdAt: true,
        reviewer: { select: { id: true, name: true, profileImageUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** "This review is unfair/abusive": into the moderation queue (one report per person). */
  async report(reviewId: string, reporterId: string, reason: (typeof REVIEW_REPORT_REASONS)[number]) {
    const r = await this.prisma.review.findFirst({ where: { id: reviewId, status: 'PUBLISHED' }, select: { id: true } });
    if (!r) throw new NotFoundException('Review not found');
    await this.prisma.reviewReport.upsert({
      where: { reviewId_reporterId: { reviewId, reporterId } },
      create: { reviewId, reporterId, reason }, update: { reason },
    });
    return { success: true };
  }
}
