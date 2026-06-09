import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const toInt = (fallback: number) => ({ value }: { value: any }) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = ({ value }: { value: any }) => value === true || value === 'true' || value === '1' || value === 1;

export class ListSiteConfDto {
  @IsOptional()
  @Transform(toInt(1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(toInt(20))
  @IsInt()
  @Min(1)
  @Max(100)
  size = 20;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class UpsertSiteConfDto {
  @IsString()
  confKey!: string;

  @IsString()
  confValue!: string;

  @IsIn(['string', 'number', 'boolean', 'json'])
  valueType!: 'string' | 'number' | 'boolean' | 'json';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isSensitive?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isRuntimeEditable?: boolean;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsOptional()
  @IsString()
  validationJson?: string;
}
