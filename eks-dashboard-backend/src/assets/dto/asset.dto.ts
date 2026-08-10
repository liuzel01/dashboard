import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

const toOptionalInt = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
};

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return value;
};

const toOptionalStringArray = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return value;
};

export class ListAssetsDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  tenant?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  business?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  accountId?: number;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  includeDeleted?: boolean;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class ListChangeLogsDto {
  @IsOptional()
  @IsString()
  assetType?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  assetId?: number;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}


export class SyncAliyunDcdnDomainsDto {
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  dryRun?: boolean;
}

export class SyncAccountDomainsDto {
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  service?: string;
}

export class SyncWangsuDomainsDto {
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  dryRun?: boolean;
}

export class CreateAssetAccountDto {
  @IsString()
  @IsNotEmpty()
  account_name!: string;

  @IsOptional()
  @IsString()
  account_type?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  domain_service_type?: string;

  @IsOptional()
  @Transform(toOptionalStringArray)
  @IsArray()
  @IsString({ each: true })
  domain_service_types?: string[];

  @IsOptional()
  @IsString()
  login_url?: string;

  @IsOptional()
  @IsString()
  account_identifier?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  usage_scope?: string;

  @IsOptional()
  @IsString()
  environment_scope?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  credential_ref_id?: number;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  mfa_enabled?: boolean;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateAssetAccountDto extends CreateAssetAccountDto {
  @IsOptional()
  @IsString()
  declare account_name: string;
}

export class CreateAssetResourceDto {
  @IsString()
  @IsNotEmpty()
  resource_name!: string;

  @IsOptional()
  @IsString()
  resource_type?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  account_id?: number;

  @IsOptional()
  @IsString()
  resource_identifier?: string;

  @IsOptional()
  @IsString()
  console_url?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  tenant?: string;

  @IsOptional()
  @IsString()
  business?: string;

  @IsOptional()
  @IsString()
  usage_desc?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateAssetResourceDto extends CreateAssetResourceDto {
  @IsOptional()
  @IsString()
  declare resource_name: string;
}

export class CreateAssetDomainDto {
  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsOptional()
  @IsString()
  root_domain?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  account_id?: number;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  resource_id?: number;

  @IsOptional()
  @IsString()
  icp_status?: string;

  @IsOptional()
  @IsString()
  icp_entity?: string;

  @IsOptional()
  @IsString()
  dns_provider?: string;

  @IsOptional()
  @IsString()
  cdn_provider?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  tenant?: string;

  @IsOptional()
  @IsString()
  business?: string;

  @IsOptional()
  @Transform(toOptionalStringArray)
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  usage_desc?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateAssetDomainDto extends CreateAssetDomainDto {
  @IsOptional()
  @IsString()
  declare domain: string;
}

export class CreateCredentialRefDto {
  @IsString()
  @IsNotEmpty()
  ref_name!: string;

  @IsOptional()
  @IsString()
  ref_type?: string;

  @IsOptional()
  @IsString()
  storage_type?: string;

  @IsOptional()
  @IsString()
  storage_path?: string;

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  @Min(1)
  related_account_id?: number;

  @IsOptional()
  @IsString()
  visibility_level?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateCredentialRefDto extends CreateCredentialRefDto {
  @IsOptional()
  @IsString()
  declare ref_name: string;
}
