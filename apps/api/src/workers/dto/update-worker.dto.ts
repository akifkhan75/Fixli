import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional,
  IsString, Max, MaxLength, Min,
} from 'class-validator';

/** Everything a worker may change about their own profile. Rating, verification and status are not here. */
export class UpdateWorkerDto {
  @IsOptional() @IsString() @MaxLength(600) bio?: string;
  /** For a company or crew; an empty string clears it. */
  @IsOptional() @IsString() @MaxLength(80) businessName?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) teamSize?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) experienceYears?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) languages?: string[];
  @IsOptional() @IsIn(['FEMALE', 'MALE']) gender?: 'FEMALE' | 'MALE';
  @IsOptional() @IsBoolean() hidePhotoUntilBooked?: boolean;
  @IsOptional() @IsBoolean() hasInsurance?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true }) equipment?: string[];
  /** This worker can tow a vehicle (has a truck/trailer). Towing jobs match only these workers. */
  @IsOptional() @IsBoolean() canTow?: boolean;

  @IsOptional() @IsIn(['FIXED', 'HOURLY', 'CALLOUT_PLUS_QUOTE', 'QUOTE']) pricingModel?: 'FIXED' | 'HOURLY' | 'CALLOUT_PLUS_QUOTE' | 'QUOTE';
  /** Integer minor units (paisa). */
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) minimumCallOutFee?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) hourlyRate?: number;

  @IsOptional() @IsLatitude() serviceLat?: number;
  @IsOptional() @IsLongitude() serviceLng?: number;
  @IsOptional() @IsString() @MaxLength(200) serviceAreaLabel?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) serviceRadius?: number;

  @IsOptional() @IsBoolean() isOnline?: boolean;
}

/** A worker's live position heartbeat while online, for immediate/roadside matching. */
export class UpdateLocationDto {
  @IsLatitude() latitude: number;
  @IsLongitude() longitude: number;
}

export class SetSkillsDto {
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(64, { each: true }) categoryIds: string[];
}

class DayHours {
  @IsInt() @Min(0) @Max(6) weekday: number;
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(1) @Max(1440) endMinute: number;
}
export class SetHoursDto {
  @IsArray() @ArrayMaxSize(7) days: DayHours[];
}

export class CreatePortfolioDto {
  @IsString() @MaxLength(80) title: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) uploadIds: string[];
}

export class SubmitVerificationDto {
  @IsIn(['ID', 'SELFIE', 'TRADE_LICENSE', 'INSURANCE']) type: 'ID' | 'SELFIE' | 'TRADE_LICENSE' | 'INSURANCE';
  @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) uploadIds: string[];
  /** e.g. the ID number the worker read from the card (CNIC 12345-1234567-1). Shown to the reviewer only. */
  @IsOptional() @IsString() @MaxLength(40) reference?: string;
}

export class WorkerQueryDto {
  @IsOptional() @IsString() @MaxLength(64) skill?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(5) minRating?: number;
}
