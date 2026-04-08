import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SqlPreviewDto {
  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @IsString()
  sql?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxRows?: number;
}
