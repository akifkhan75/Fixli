import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateDisputeDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  jobRequestId: string;

  @IsOptional() @IsString() @MaxLength(64)
  category?: string;

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

export class ResolveDisputeDto {
  @IsIn(['IN_REVIEW', 'RESOLVED', 'CLOSED'])
  status: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

  @IsOptional() @IsString() @MaxLength(2000)
  resolution?: string;
}
