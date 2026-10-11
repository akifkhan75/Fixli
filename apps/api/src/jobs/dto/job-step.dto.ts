import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Before/after photos for start/finish: your own JOB_PHOTO upload ids (never storage keys). */
export class JobStepPhotosDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(64, { each: true })
  photoUploadIds?: string[];
}
