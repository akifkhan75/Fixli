import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsString() @IsNotEmpty() @MaxLength(300) streetAddress: string;
  @IsString() @IsNotEmpty() @MaxLength(100) city: string;
  /** Neighbourhood / sector / block */
  @IsOptional() @IsString() @MaxLength(120) area?: string;
  /** "Opposite the mosque", "next to the blue gate" */
  @IsOptional() @IsString() @MaxLength(200) landmark?: string;
  /** Flat / floor / building name */
  @IsOptional() @IsString() @MaxLength(120) buildingDetail?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  /** ISO 3166-1 alpha-2 */
  @IsString() @Length(2, 2) country: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  /** Required so matching can find nearby workers (city-only fallback is unreliable). */
  @IsLatitude() latitude: number;
  @IsLongitude() longitude: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
