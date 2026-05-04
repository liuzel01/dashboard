import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResolveIngressSourceDto {
  @IsString()
  @IsNotEmpty()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  namespace!: string;

  @IsOptional()
  @IsString()
  lineUrl?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
