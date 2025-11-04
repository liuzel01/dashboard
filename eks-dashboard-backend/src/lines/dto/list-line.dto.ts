import { IsOptional, IsString, IsNumberString } from 'class-validator';

export class ListLineDto {
  @IsOptional()
  @IsString()
  lineUrl?: string;

  @IsNumberString()
  page: string;

  @IsNumberString()
  size: string;

  @IsNumberString()
  tenantId: string;
}
