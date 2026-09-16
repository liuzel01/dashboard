import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export class ApplyIngressManifestDto {
  @IsString()
  @IsNotEmpty()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  manifestYaml!: string;

  // Kept for traceability only.  The edited manifest is the source of truth.
  @IsOptional()
  @IsString()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'sourceIngressName format is invalid' })
  sourceIngressName?: string;

  @IsBoolean()
  confirmed!: boolean;
}
