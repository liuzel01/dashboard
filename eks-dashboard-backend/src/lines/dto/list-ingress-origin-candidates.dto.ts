import { IsOptional, IsString } from 'class-validator';

export class ListIngressOriginCandidatesDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}

