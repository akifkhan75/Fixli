import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class IncidentUpdateDto {
  @IsIn(['INVESTIGATING', 'RESOLVED']) status: 'INVESTIGATING' | 'RESOLVED';
  /** What was done (who was called, outcome). Required to resolve. */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
