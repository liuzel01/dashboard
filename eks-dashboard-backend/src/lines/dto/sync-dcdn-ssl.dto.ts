import { IsOptional, IsString, Matches } from 'class-validator';

const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export class SyncDcdnSslDto {
  @IsString()
  lineUrl!: string;

  @IsOptional()
  @IsString()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'namespace format is invalid' })
  namespace?: string;
}
