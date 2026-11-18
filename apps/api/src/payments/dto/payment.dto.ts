import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class MarkCashDto {
  /** Cash actually received, integer minor units. Currency always comes from the job. */
  @IsInt() @Min(1) @Max(100_000_000)
  amount!: number;

  /** Optional client-generated key; a repeat with the same key returns the same payment. */
  @IsOptional() @IsUUID()
  idempotencyKey?: string;
}

export class DisputePaymentDto {
  /** What the customer says they really paid, minor units (0 = nothing). */
  @IsInt() @Min(0) @Max(100_000_000)
  claimedAmount!: number;
}
