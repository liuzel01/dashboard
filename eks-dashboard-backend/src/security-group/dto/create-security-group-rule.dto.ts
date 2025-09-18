import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  Matches,
  ValidateIf,
} from 'class-validator';

export class CreateSecurityGroupRuleDto {
  @IsString()
  @IsNotEmpty()
  protocol: string; // 'tcp', 'udp', 'icmp', or '-1' for all

  @ValidateIf((o) => o.protocol !== '-1')
  @IsInt()
  @Min(1, { message: 'Port must be at least 1' })
  @Max(65535, { message: 'Port must be at most 65535' })
  fromPort: number;

  @ValidateIf((o) => o.protocol !== '-1')
  @IsInt()
  @Min(1, { message: 'Port must be at least 1' })
  @Max(65535, { message: 'Port must be at most 65535' })
  toPort: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, {
    message: 'Source must be a valid CIDR block (e.g., 192.168.1.1/32)',
  })
  cidrIp: string;

  @IsOptional()
  @IsString()
  description?: string;
}
