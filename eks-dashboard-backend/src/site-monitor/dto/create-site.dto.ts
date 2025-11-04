import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(255)
  host!: string; // domain or host

  @IsInt()
  @Min(1)
  port!: number; // e.g., 80/443

  @IsBoolean()
  isHttps!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  environmentLabel?: string; // optional tag like "prod", "staging"

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsInt()
  tenantId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  acceptableStatusCodes?: string; // e.g., "200-399" or "200,302,404"
}
