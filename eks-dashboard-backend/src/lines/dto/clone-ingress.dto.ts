import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const DNS_HOST_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export class CloneIngressDto {
  @IsString()
  @IsNotEmpty()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  namespace!: string;

  @IsString()
  @IsNotEmpty()
  sourceIngressName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(DNS_HOST_REGEX, { message: 'newHost format is invalid' })
  newHost!: string;

  @IsOptional()
  @IsString()
  @Matches(K8S_RESOURCE_NAME_REGEX, { message: 'newIngressName format is invalid' })
  newIngressName?: string;
}
