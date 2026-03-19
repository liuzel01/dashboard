import { IsNotEmpty, IsOptional, IsString, IsObject, IsArray } from 'class-validator';

export class CreateEnvironmentConfigDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  super_admin_url?: string;

  @IsString()
  @IsNotEmpty()
  aws_region!: string;

  @IsOptional()
  @IsString()
  aws_access_key_id?: string;

  @IsOptional()
  @IsString()
  aws_secret_access_key?: string;

  @IsOptional()
  @IsString()
  aws_profile?: string;

  @IsOptional()
  @IsString()
  kubeContext?: string;

  @IsOptional()
  @IsObject()
  database?: Record<string, any>;

  @IsOptional()
  @IsObject()
  redis?: Record<string, any>;

  @IsOptional()
  @IsObject()
  jumpServer?: Record<string, any>;

  @IsOptional()
  @IsArray()
  tenants?: any[];

  @IsOptional()
  @IsArray()
  platforms?: any[];

  @IsOptional()
  @IsObject()
  alerts?: Record<string, any>;
}

export class UpdateEnvironmentConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  super_admin_url?: string;

  @IsOptional()
  @IsString()
  aws_region?: string;

  @IsOptional()
  @IsString()
  aws_access_key_id?: string;

  @IsOptional()
  @IsString()
  aws_secret_access_key?: string;

  @IsOptional()
  @IsString()
  aws_profile?: string;

  @IsOptional()
  @IsString()
  kubeContext?: string;

  @IsOptional()
  @IsObject()
  database?: Record<string, any>;

  @IsOptional()
  @IsObject()
  redis?: Record<string, any>;

  @IsOptional()
  @IsObject()
  jumpServer?: Record<string, any>;

  @IsOptional()
  @IsArray()
  tenants?: any[];

  @IsOptional()
  @IsArray()
  platforms?: any[];

  @IsOptional()
  @IsObject()
  alerts?: Record<string, any>;
}
