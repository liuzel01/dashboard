import { IsOptional, IsString, Matches } from 'class-validator';

const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export class AgentResolveIngressTlsSecretDto {
  @IsString()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'namespace format is invalid' })
  namespace!: string;

  @IsString()
  lineUrl!: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
