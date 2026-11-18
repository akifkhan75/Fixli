import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const DISPUTE_CATEGORIES = ['QUALITY', 'NO_SHOW', 'PRICE', 'DAMAGE', 'BEHAVIOUR', 'OTHER'] as const;

/**
 * What a customer or worker may send. Held amounts are set by the payment flow (never the client),
 * and evidence files are attached through uploads, not by naming storage keys.
 */
export class CreateDisputeDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  jobRequestId: string;

  @IsOptional() @IsIn(DISPUTE_CATEGORIES as unknown as string[])
  category?: (typeof DISPUTE_CATEGORIES)[number];

  @IsString() @IsNotEmpty() @MaxLength(120)
  reason: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}

export class ResolveDisputeDto {
  @IsIn(['IN_REVIEW', 'RESOLVED', 'CLOSED'])
  status: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

  @IsOptional() @IsString() @MaxLength(2000)
  resolution?: string;
}
