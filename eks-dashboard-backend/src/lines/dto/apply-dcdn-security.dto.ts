import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ApplyDcdnSecurityDto {
  @IsString()
  @IsNotEmpty()
  domainName!: string;

  @IsString()
  @IsNotEmpty()
  sslPub!: string;

  @IsString()
  @IsNotEmpty()
  sslPri!: string;

  @IsOptional()
  @IsString()
  certName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['cas', 'upload'])
  certSource?: 'cas' | 'upload';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  enableWebsocket?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  enableWaf?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['http', 'https', 'follow'])
  websocketOriginScheme?: 'http' | 'https' | 'follow';

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(300)
  websocketHeartbeat?: number;
}
