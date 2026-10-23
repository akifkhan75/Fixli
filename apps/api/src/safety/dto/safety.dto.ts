import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const SOS_KINDS = ['LIFE_THREATENING', 'WATER', 'ELECTRIC', 'GAS', 'IN_JOB'] as const;
export type SosKind = (typeof SOS_KINDS)[number];
export const PROPERTY_KINDS: SosKind[] = ['WATER', 'ELECTRIC', 'GAS'];

export class SosDto {
  @IsIn(SOS_KINDS)
  kind: SosKind;

  /** Property emergencies: where (default address if omitted). */
  @IsOptional() @IsString() @MaxLength(64)
  addressId?: string;

  /** In-job SOS: the job you're on. */
  @IsOptional() @IsString() @MaxLength(64)
  jobRequestId?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  /** Client-generated so a double tap or a retry doesn't create two emergencies. */
  @IsString() @MaxLength(64)
  idempotencyKey: string;
}

export class ReportIncidentDto {
  @IsIn(['REPORT_PROBLEM'])
  type: 'REPORT_PROBLEM';

  @IsIn(['MODERATE', 'PROPERTY_DAMAGE'])
  severity: 'MODERATE' | 'PROPERTY_DAMAGE';

  @IsOptional() @IsString() @MaxLength(64)
  targetId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  jobRequestId?: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  description: string;
}

export class AddTrustedContactDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  /** Any format the person types; normalised to E.164 for their country. */
  @IsString() @IsNotEmpty() @MaxLength(30)
  phone: string;

  @IsOptional() @IsBoolean()
  notifyOnSos?: boolean;
}
