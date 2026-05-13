import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateReviewDto {
  @IsOptional()
  @IsString()
  @IsIn(['new', 'reviewing', 'uncertain', 'mastered', 'archived'])
  status?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return value;
  })
  @IsBoolean()
  isImportant?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  myFinalAnswer?: string;

  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high'])
  confidence?: string;

  @IsOptional()
  @IsString()
  @IsIn(['correct', 'wrong', 'uncertain', 'skipped'])
  lastResult?: string;

  @IsOptional()
  @IsISO8601()
  nextReviewAt?: string | null;
}
