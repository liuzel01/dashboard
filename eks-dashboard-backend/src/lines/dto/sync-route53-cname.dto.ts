import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DOMAIN_REGEX = /^(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;

export class SyncRoute53CnameDto {
  @IsString()
  @Matches(DOMAIN_REGEX, { message: 'rootDomain format is invalid' })
  rootDomain!: string;

  @IsString()
  @Matches(DOMAIN_REGEX, { message: 'domainName format is invalid' })
  domainName!: string;

  @IsString()
  @Matches(DOMAIN_REGEX, { message: 'cnameValue format is invalid' })
  cnameValue!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  hostedZoneId?: string;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}
