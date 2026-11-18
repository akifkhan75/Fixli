import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class StartJobDto {
  @IsOptional() @IsString() @MaxLength(256)
  beforePhotoKey?: string;

  /** Emergency jobs only: main power / gas / water shut-off located and verified OFF. */
  @IsOptional() @IsBoolean()
  shutoffVerified?: boolean;

  /** Emergency jobs only: protective equipment is on. */
  @IsOptional() @IsBoolean()
  protectiveEquipment?: boolean;
}
