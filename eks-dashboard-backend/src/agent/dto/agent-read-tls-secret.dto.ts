import { IsNotEmpty, IsString, Matches } from 'class-validator';

const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export class AgentReadTlsSecretDto {
  @IsString()
  @IsNotEmpty()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'namespace format is invalid' })
  namespace!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'secretName format is invalid' })
  secretName!: string;
}
