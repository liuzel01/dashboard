import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';

const DOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class AgentApplyTenantDomainDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tenantId!: number;

  @IsString()
  @IsNotEmpty()
  @Matches(DOMAIN_REGEX, { message: 'domain format is invalid' })
  domain!: string;
}
