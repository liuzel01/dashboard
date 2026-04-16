import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListLineInventoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number = 20;

  @IsOptional()
  @IsString()
  lineUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tenantId?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean()
  status?: boolean;

  @IsOptional()
  @IsIn(['aliyun_dcdn', 'aws_global', 'aliyun_esa', 'unknown'])
  provider?: 'aliyun_dcdn' | 'aws_global' | 'aliyun_esa' | 'unknown';

  @IsOptional()
  @IsIn(['up', 'down', 'unknown'])
  availability?: 'up' | 'down' | 'unknown';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  certExpireDaysLt?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean()
  refresh?: boolean;
}
