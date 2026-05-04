import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AgentResolveIngressSourceDto {
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
