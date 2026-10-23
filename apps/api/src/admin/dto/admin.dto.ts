import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ADMIN_ROLES, AdminRole } from '../../common/auth/permissions';

export class VerificationQueryDto {
  @IsOptional() @IsIn(['SUBMITTED', 'APPROVED', 'REJECTED', 'NEEDS_INFO']) status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'NEEDS_INFO';
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
}

export class VerificationDecisionDto {
  @IsIn(['APPROVE', 'REJECT', 'NEEDS_INFO']) decision: 'APPROVE' | 'REJECT' | 'NEEDS_INFO';
  /** Required for REJECT / NEEDS_INFO: shown to the worker in plain language. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ActionReasonDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}

export class PageQueryDto {
  @IsOptional() @IsInt() @Min(0) @Max(100_000) skip?: number;
}

export class UserSearchDto {
  @IsOptional() @IsString() @MaxLength(100) @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}

export const JOB_STATUSES = ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'] as const;
export class JobListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(JOB_STATUSES) status?: (typeof JOB_STATUSES)[number];
}

export class IncidentQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['OPEN', 'INVESTIGATING', 'RESOLVED']) status?: string;
}

export class SetRolesDto {
  @IsArray() @ArrayMaxSize(ADMIN_ROLES.length) @IsIn(ADMIN_ROLES, { each: true })
  roles: AdminRole[];
}
