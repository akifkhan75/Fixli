import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Tags a customer can give a professional. */
export const WORKER_REVIEW_TAGS = ['ON_TIME', 'FRIENDLY', 'CLEAN', 'FAIR_PRICE', 'SKILLED', 'EXPLAINED_WELL'] as const;
/** Tags a professional can give a customer (private: never shown publicly). */
export const CUSTOMER_REVIEW_TAGS = ['RESPECTFUL', 'CLEAR_INSTRUCTIONS', 'PAID_PROMPTLY', 'EASY_ACCESS'] as const;
export const REVIEW_TAGS = [...WORKER_REVIEW_TAGS, ...CUSTOMER_REVIEW_TAGS] as const;

export class CreateReviewDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  jobRequestId: string;

  @IsInt() @Min(1) @Max(5)
  rating: number;

  @IsOptional() @IsString() @MaxLength(1000)
  comment?: string;

  /** Up to 5 from the list for the person you're reviewing (checked by role in the service). */
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(REVIEW_TAGS, { each: true })
  tags?: (typeof REVIEW_TAGS)[number][];
}
