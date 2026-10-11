import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const PHOTO_SKIP_REASONS = ['CAMERA_UNAVAILABLE', 'CUSTOMER_DECLINED', 'NOT_APPLICABLE'] as const;

/** Before/after photos for start/finish: your own JOB_PHOTO upload ids (never storage keys). */
export class JobStepPhotosDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(64, { each: true })
  photoUploadIds?: string[];

  /** No photo possible: say why (recorded on the job timeline). */
  @ApiPropertyOptional({ enum: PHOTO_SKIP_REASONS }) @IsOptional() @IsIn(PHOTO_SKIP_REASONS)
  photoSkipReason?: (typeof PHOTO_SKIP_REASONS)[number];
}
