import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export class AgentApplyIngressManifestDto {
  @IsString()
  @IsNotEmpty()
  manifestYaml!: string;

  @IsOptional()
  @IsString()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'sourceIngressName format is invalid' })
  sourceIngressName?: string;

  @IsBoolean()
  confirmed!: boolean;
}
