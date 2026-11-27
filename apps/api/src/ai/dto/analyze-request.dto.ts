import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeRequestDto {
  @ApiProperty({ example: 'Water is leaking under the kitchen sink' })
  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(64)
  categoryId?: string;

  /** Codes of the common problems the customer tapped. */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(64, { each: true })
  issueCodes?: string[];

  /** JOB_PHOTO uploads (already completed) to look at. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true })
  photoUploadIds?: string[];
}

export class ProjectScopeDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  categoryId: string;

  @IsIn(['NEW_BUILD', 'RENOVATION', 'INSTALLATION', 'MAINTENANCE'])
  workType: 'NEW_BUILD' | 'RENOVATION' | 'INSTALLATION' | 'MAINTENANCE';

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true })
  photoUploadIds?: string[];

  @IsOptional() @IsIn(['en', 'ur', 'ar'])
  locale?: 'en' | 'ur' | 'ar';
}

export class IdOcrDto {
  /** A completed VERIFICATION upload: the front of the ID card. */
  @IsString() @IsNotEmpty() @MaxLength(64)
  uploadId: string;
}

export class TranscribeDto {
  /** A completed JOB_AUDIO upload. */
  @IsString() @IsNotEmpty() @MaxLength(64)
  uploadId: string;

  @IsOptional() @IsIn(['en', 'ur', 'ar'])
  locale?: 'en' | 'ur' | 'ar';
}

export class SafetyCheckDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  description: string;
}

export class QuoteDraftDto {
  @IsString() @IsNotEmpty() @MaxLength(2000)
  jobDescription: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  workerNotes: string;
}
