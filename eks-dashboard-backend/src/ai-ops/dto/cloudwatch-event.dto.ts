import { IsObject, IsOptional, IsString } from 'class-validator';

export class CloudWatchEventDto {
  @IsOptional()
  @IsString()
  AlarmName?: string;

  @IsOptional()
  @IsString()
  AlarmArn?: string;

  @IsOptional()
  @IsString()
  NewStateValue?: string;

  @IsOptional()
  @IsString()
  StateChangeTime?: string;

  @IsOptional()
  @IsObject()
  Trigger?: Record<string, unknown>;

  [key: string]: unknown;
}
