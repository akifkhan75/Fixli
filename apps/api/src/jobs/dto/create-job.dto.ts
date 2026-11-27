import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJobDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64)
  categoryId: string;

  @ApiPropertyOptional({ example: ['leaking_tap'] })
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(64, { each: true })
  issueCodes?: string[];

  @ApiPropertyOptional({ example: 'Water drips under the kitchen sink all night' })
  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  /** Completed JOB_PHOTO uploads. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true })
  photoUploadIds?: string[];

  /** Completed JOB_AUDIO upload, plus the transcript the customer saw and confirmed. */
  @IsOptional() @IsString() @MaxLength(64)
  audioUploadId?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  audioTranscript?: string;

  /**
   * One of the customer's saved addresses. Omit it to send a one-off location pin instead
   * (latitude + longitude) — used for roadside / "I'm here right now" requests where the
   * problem isn't at a saved address. Send exactly one of the two.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64)
  addressId?: string;

  /** One-off pin latitude (send with longitude, instead of addressId). */
  @ApiPropertyOptional() @IsOptional() @IsLatitude()
  latitude?: number;

  /** One-off pin longitude (send with latitude, instead of addressId). */
  @ApiPropertyOptional() @IsOptional() @IsLongitude()
  longitude?: number;

  /** Coarse neighbourhood for a pin, shown to workers before booking (never exact). */
  @IsOptional() @IsString() @MaxLength(120)
  area?: string;

  /** City for a pin, shown to workers before booking. */
  @IsOptional() @IsString() @MaxLength(100)
  city?: string;

  /** "Outside the blue gate", "near the petrol pump" — helps a worker reach a pinned spot. */
  @IsOptional() @IsString() @MaxLength(200)
  landmark?: string;

  @ApiProperty({ enum: ['NOW', 'TODAY', 'TOMORROW', 'SCHEDULED'] })
  @IsIn(['NOW', 'TODAY', 'TOMORROW', 'SCHEDULED'])
  when: 'NOW' | 'TODAY' | 'TOMORROW' | 'SCHEDULED';

  /** YYYY-MM-DD in the customer's local calendar (SCHEDULED only). */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional() @IsIn(['MORNING', 'AFTERNOON', 'EVENING'])
  timeSlot?: 'MORNING' | 'AFTERNOON' | 'EVENING';

  @IsOptional() @IsBoolean()
  isEmergency?: boolean;

  /** The /ai/analyze result the customer saw, linked for later evaluation (doc 08). */
  @IsOptional() @IsString() @MaxLength(64)
  analysisId?: string;

  /** Generated once per request on the device; resending it returns the same job. */
  @ApiProperty() @IsString() @Length(8, 64)
  idempotencyKey: string;
}
