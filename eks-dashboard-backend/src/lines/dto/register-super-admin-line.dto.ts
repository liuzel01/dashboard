import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RegisterSuperAdminLineDto {
  @IsString()
  @IsNotEmpty()
  lineUrl!: string;

  @IsOptional()
  @IsString()
  otcUrl?: string;

  @IsString()
  @IsNotEmpty()
  zh!: string;

  @IsString()
  @IsNotEmpty()
  en!: string;

  @IsBoolean()
  @Type(() => Boolean)
  status!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tenantId!: number;

  @IsOptional()
  @IsString()
  @IsIn(['detect', 'update'])
  mode?: 'detect' | 'update';
}

