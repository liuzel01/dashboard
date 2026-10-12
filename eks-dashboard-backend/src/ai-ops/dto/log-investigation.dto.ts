import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class LogInvestigationDto {
  @IsString()
  @MaxLength(64)
  projectId!: string;

  @IsString()
  @MaxLength(128)
  sourceId!: string;

  @IsString()
  @MaxLength(128)
  namespace!: string;

  @IsString()
  @MaxLength(2000)
  @Matches(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]+$/, {
    message: 'question 包含不允许的控制字符',
  })
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  serviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  queryText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  rangeMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
