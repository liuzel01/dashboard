import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateQuestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  examCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  source!: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceQuestionNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sourceTopic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsString()
  @IsNotEmpty()
  stem!: string;

  @IsObject()
  options!: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceAnswer?: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  rawHtml?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  tags?: string[];
}
