import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, Length, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { MAX_MILESTONES, MAX_PROJECT_AMOUNT, MAX_PROJECT_PHOTOS } from './project-state';

export const WORK_TYPES = ['NEW_BUILD', 'RENOVATION', 'INSTALLATION', 'MAINTENANCE'] as const;
export const PROPERTY_TYPES = ['HOUSE', 'APARTMENT', 'SHOP', 'OFFICE', 'OTHER'] as const;
export const START_WHEN = ['ASAP', 'THIS_MONTH', 'LATER'] as const;

export class SuggestedStageDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  title: string;

  @IsInt() @Min(1) @Max(100)
  percent: number;
}

export class CreateProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  categoryId: string;

  @IsString() @MinLength(3) @MaxLength(100)
  title: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsIn(WORK_TYPES)
  workType: (typeof WORK_TYPES)[number];

  @IsOptional() @IsIn(PROPERTY_TYPES)
  propertyType?: (typeof PROPERTY_TYPES)[number];

  @IsString() @IsNotEmpty() @MaxLength(64)
  addressId: string;

  @IsOptional() @IsInt() @Min(1) @Max(MAX_PROJECT_AMOUNT)
  budgetMin?: number;

  @IsOptional() @IsInt() @Min(1) @Max(MAX_PROJECT_AMOUNT)
  budgetMax?: number;

  @IsOptional() @IsIn(START_WHEN)
  startWhen?: (typeof START_WHEN)[number];

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PROJECT_PHOTOS) @IsString({ each: true }) @MaxLength(64, { each: true })
  photoUploadIds?: string[];

  @IsOptional() @IsString() @MaxLength(64)
  audioUploadId?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  audioTranscript?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_MILESTONES) @ValidateNested({ each: true }) @Type(() => SuggestedStageDto)
  suggestedMilestones?: SuggestedStageDto[];

  /** Save without telling professionals yet. */
  @IsOptional() @IsBoolean()
  draft?: boolean;

  @IsString() @Length(8, 64)
  idempotencyKey: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100)
  title?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsOptional() @IsInt() @Min(1) @Max(MAX_PROJECT_AMOUNT)
  budgetMin?: number;

  @IsOptional() @IsInt() @Min(1) @Max(MAX_PROJECT_AMOUNT)
  budgetMax?: number;

  @IsOptional() @IsIn(START_WHEN)
  startWhen?: (typeof START_WHEN)[number];
}

export class BidStageDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  title: string;

  @IsInt() @Min(1) @Max(MAX_PROJECT_AMOUNT)
  amount: number;
}

export class SubmitBidDto {
  @IsInt() @Min(1) @Max(MAX_PROJECT_AMOUNT)
  totalAmount: number;

  @IsInt() @Min(1) @Max(730)
  durationDays: number;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  /** Payment stages; left out = one stage for the whole amount. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_MILESTONES) @ValidateNested({ each: true }) @Type(() => BidStageDto)
  milestones?: BidStageDto[];
}

export class AwardDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  bidId: string;

  @IsIn(['ESCROW', 'DIRECT'])
  paymentMode: 'ESCROW' | 'DIRECT';
}

export class CancelProjectDto {
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

export class SubmitStageDto {
  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;

  /** Completed JOB_PHOTO uploads showing the finished work. */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(64, { each: true })
  photoUploadIds?: string[];
}

export class RequestChangesDto {
  @IsString() @MinLength(3) @MaxLength(1000)
  note: string;
}

export class StageDisputeDto {
  @IsString() @MinLength(3) @MaxLength(120)
  reason: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}

export class AddMaterialDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsNumber() @Min(0.01) @Max(1_000_000)
  quantity: number;

  @IsOptional() @IsString() @MaxLength(20)
  unit?: string;

  @IsIn(['customer', 'worker'])
  providedBy: 'customer' | 'worker';
}

export class UpdateMaterialDto {
  @IsBoolean()
  isReady: boolean;
}

export class AddVisitDto {
  @IsDateString()
  scheduledAt: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class UpdateVisitDto {
  @IsIn(['DONE', 'CANCELLED'])
  status: 'DONE' | 'CANCELLED';
}
