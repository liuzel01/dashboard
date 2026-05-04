import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AgentListIngressSourceCandidatesDto {
  @IsString()
  @IsNotEmpty()
  namespace!: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
