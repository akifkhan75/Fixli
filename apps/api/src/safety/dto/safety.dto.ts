import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean, IsIn, IsNumber, Min, Max, Length, Matches } from 'class-validator';

export const SOS_KINDS = ['WATER', 'ELECTRICAL', 'GAS'] as const;
export type SosKind = (typeof SOS_KINDS)[number];

export class ReportIncidentDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['SOS', 'EMERGENCY', 'REPORT_PROBLEM'])
  type: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['LIFE_THREATENING', 'PROPERTY_DAMAGE', 'MODERATE'])
  severity: string;

  @IsOptional() @IsString() @MaxLength(64)
  targetId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  jobRequestId?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  /** Where the person is, if the phone could tell (never required). */
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;

  /** Property emergencies only: what kind of hazard (chooses the trade). */
  @IsOptional() @IsIn(SOS_KINDS as unknown as string[])
  sosKind?: SosKind;

  /** Property emergencies only: one of the customer's saved addresses. */
  @IsOptional() @IsString() @MaxLength(64)
  addressId?: string;

  /** Generated once per SOS on the device; a retry returns the same incident and job. */
  @IsOptional() @IsString() @Length(8, 64)
  idempotencyKey?: string;
}

export class AddTrustedContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** International format, e.g. +923001234567. */
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be in international format, e.g. +923001234567' })
  phone: string;

  @IsOptional()
  @IsBoolean()
  notifyOnSos?: boolean;
}
