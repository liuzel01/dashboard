import { IsOptional, IsString } from 'class-validator';

export class AgentListIngressSourceCandidatesDto {
  @IsOptional()
  @IsString()
  namespace?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
