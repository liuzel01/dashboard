import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class LogSearchDto {
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  projectId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(128)
  sourceId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(128)
  namespace?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  serviceName?: string;

  @IsOptional()
  @IsIn(['positionId', 'uid', 'orderId', 'traceId', 'requestId'])
  entityField?: 'positionId' | 'uid' | 'orderId' | 'traceId' | 'requestId';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(256)
  @Matches(/^[^\r\n\u0000-\u001f]+$/, {
    message: 'entityValue 包含不允许的控制字符',
  })
  entityValue?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(512)
  @Matches(/^[^\r\n\u0000-\u001f]+$/, {
    message: 'queryText 包含不允许的控制字符',
  })
  queryText?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
