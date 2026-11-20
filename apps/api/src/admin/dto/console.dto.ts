import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ADMIN_ROLES, AdminRole } from '../../common/auth/permissions';

export class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CursorQuery {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
}

export class AuditQuery extends CursorQuery {
  @IsOptional() @IsString() @MaxLength(64) actorId?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsString() @MaxLength(64) action?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class IncidentListQuery extends CursorQuery {
  @IsOptional() @IsIn(['OPEN', 'INVESTIGATING', 'RESOLVED']) status?: string;
  @IsOptional() @IsIn(['SOS', 'REPORT_PROBLEM', 'REPORT_USER']) type?: string;
}

export class IncidentUpdateDto {
  @IsOptional() @IsIn(['OPEN', 'INVESTIGATING', 'RESOLVED']) status?: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
  @IsOptional() @IsString() @MinLength(2) @MaxLength(2000) note?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class PaymentQuery extends CursorQuery {
  @IsOptional() @IsIn(['MARKED_BY_WORKER', 'CONFIRMED', 'DISPUTED', 'VOIDED']) status?: string;
}

export class AdjustmentDto {
  /** Change in what the worker owes, minor units (+ more, − less). */
  @IsInt() @Min(-100_000_000) @Max(100_000_000) amount: number;
  @IsString() @MinLength(3) @MaxLength(300) note: string;
  /** Client-generated: a double click books it once. */
  @IsString() @MinLength(8) @MaxLength(64) idempotencyKey: string;
}

export class ModerateReviewDto {
  @IsIn(['HIDE', 'RESTORE', 'DISMISS']) action: 'HIDE' | 'RESTORE' | 'DISMISS';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class UpdateCategoryContentDto {
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
  @IsOptional() @IsObject() translations?: Record<string, { name?: string; description?: string }>;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class IssueDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,40}$/) code: string;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsObject() translations?: Record<string, { name?: string }>;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PriceBandDto {
  @IsString() @MaxLength(64) categoryId: string;
  @IsOptional() @IsString() @MaxLength(64) issueCode?: string;
  @IsString() @MinLength(2) @MaxLength(60) city: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency: string;
  @IsInt() @Min(1) @Max(100_000_000) minMinor: number;
  @IsInt() @Min(1) @Max(100_000_000) maxMinor: number;
  @IsOptional() @IsBoolean() approved?: boolean;
}

class CommissionDto {
  @IsInt() @Min(0) @Max(5000) rateBps: number;
  @IsInt() @Min(0) minMinor: number;
  @IsInt() @Min(0) maxMinor: number;
}
class CashLimitsDto {
  @IsInt() @Min(0) softMinor: number;
  @IsInt() @Min(1) hardMinor: number;
  @IsInt() @Min(1) @Max(90) maxDaysOwed: number;
}
class RailDto {
  @IsString() @Matches(/^[A-Z_]{2,20}$/) id: string;
  @IsString() @MinLength(2) @MaxLength(40) label: string;
  @IsOptional() @IsString() @MaxLength(80) account?: string | null;
}
class EmergencyNumberDto {
  @IsString() @MinLength(2) @MaxLength(40) label: string;
  @IsString() @Matches(/^\d{2,6}$/) number: string;
}
export class CountryConfigDto {
  @ValidateNested() @Type(() => CommissionDto) commission: CommissionDto;
  @ValidateNested() @Type(() => CashLimitsDto) cashLimits: CashLimitsDto;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => RailDto) settlementRails: RailDto[];
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => EmergencyNumberDto) emergencyNumbers: EmergencyNumberDto[];
  /** The version you edited: refused if someone saved since (no silent overwrite). */
  @IsInt() @Min(0) baseVersion: number;
}

export class FlagDto {
  @IsBoolean() value: boolean;
}

export class CreateStaffDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsArray() @ArrayMaxSize(ADMIN_ROLES.length) @IsIn(ADMIN_ROLES, { each: true }) roles: AdminRole[];
}
