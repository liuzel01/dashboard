import { IsInt, IsOptional, IsString, MaxLength, Min, IsBoolean } from 'class-validator';

export class UpdateSiteDto {
  @IsOptional()
  @IsInt()
  tenantId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  port?: number;

  @IsOptional()
  @IsBoolean()
  isHttps?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  acceptableStatusCodes?: string;
}
