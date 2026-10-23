import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What a person may send. Deliberately no `isSystem`, sender or receiver: those come from the
 * server (unknown fields are rejected), so nobody can post a fake "Fixli" message.
 */
export class SendMessageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000)
  text?: string;

  /** Idempotency key from the app; resending the same clientId returns the first message. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128)
  clientId?: string;

  /** A CHAT_PHOTO upload of yours (POST /uploads ... /complete). Never a storage key. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  imageUploadId?: string;
}
