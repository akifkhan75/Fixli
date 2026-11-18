import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  /** Re-authentication: a stolen session alone must not be able to erase an account. */
  @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;
}
