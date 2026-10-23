import { IsIn } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { REVIEW_REPORT_REASONS } from './reviews.service';
import { Controller, Get, Post, Body, Param, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/review.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class ReportReviewDto {
  @IsIn(REVIEW_REPORT_REASONS) reason: (typeof REVIEW_REPORT_REASONS)[number];
}

@ApiTags('reviews')
@ApiBearerAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: 'Review the other party of a completed job' })
  create(@CurrentUser() user: { id: string; type: string }, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(user, dto);
  }

  @Get('user/:targetId')
  @ApiOperation({ summary: 'Reviews received by a user/worker' })
  findByTarget(@Param('targetId') targetId: string) {
    return this.reviewsService.findByTarget(targetId);
  }

  @Post(':id/report')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Report a review to moderators' })
  report(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: ReportReviewDto) {
    return this.reviewsService.report(id, userId, dto.reason);
  }
}
