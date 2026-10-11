import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const JOB_STATUSES = [
  'CREATED',
  'MATCHES_FOUND',
  'AWAITING_WORKER',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
] as const;

export class JobQueryDto {
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];

  /** active = booked and not finished (every on-site step); past = completed or cancelled. */
  @IsOptional()
  @IsIn(['active', 'past'])
  group?: 'active' | 'past';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  serviceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}
