import { IsObject, IsOptional, IsString } from 'class-validator';

export class SlowQueryEventDto {
  @IsOptional()
  @IsString()
  fingerprint?: string;

  @IsOptional()
  @IsString()
  sql?: string;

  @IsOptional()
  @IsString()
  instanceId?: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;

  @IsOptional()
  @IsObject()
  detail?: Record<string, unknown>;

  [key: string]: unknown;
}
