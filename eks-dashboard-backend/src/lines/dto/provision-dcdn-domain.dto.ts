import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProvisionDcdnDomainDto {
  @IsString()
  @IsNotEmpty()
  domainName!: string;

  @IsString()
  @IsNotEmpty()
  originDomain!: string;

  @IsOptional()
  @IsString()
  @IsIn(['global', 'domestic', 'overseas'])
  scope?: 'global' | 'domestic' | 'overseas';
}
