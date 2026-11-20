import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export const DISPUTE_CATEGORIES = ['PAYMENT', 'QUALITY', 'DAMAGE', 'NO_SHOW', 'PRICE', 'BEHAVIOUR', 'OTHER'] as const;

export class CreateDisputeDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  jobRequestId: string;

  @IsOptional() @IsIn(DISPUTE_CATEGORIES)
  category?: (typeof DISPUTE_CATEGORIES)[number];

  @IsString() @IsNotEmpty() @MaxLength(120)
  reason: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  /** Amount in dispute, integer minor units. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000)
  amountHeld?: number;

  /** Your own JOB_PHOTO upload ids (never storage keys). */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(64, { each: true })
  evidenceUploadIds?: string[];
}

export class LedgerAdjustmentDto {
  /** Change in what the worker owes, minor units (+ more, − less). Needs finance.adjust. */
  @IsInt() @Min(-100_000_000) @Max(100_000_000)
  amount: number;

  @IsString() @MinLength(3) @MaxLength(300)
  note: string;
}

export class ResolveDisputeDto {
  @IsIn(['IN_REVIEW', 'RESOLVED', 'CLOSED'])
  status: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

  @IsOptional() @IsString() @MaxLength(2000)
  resolution?: string;

  /** For a payment dispute: the cash was paid after all (commission booked), or it wasn't. */
  @IsOptional() @IsIn(['CONFIRM', 'VOID'])
  paymentOutcome?: 'CONFIRM' | 'VOID';

  @IsOptional() @ValidateNested() @Type(() => LedgerAdjustmentDto)
  ledgerAdjustment?: LedgerAdjustmentDto;
}
