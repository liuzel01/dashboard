import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ListIngressSourceCandidatesDto {
  @IsString()
  @IsNotEmpty()
  environmentId!: string;

  @IsOptional()
  @IsString()
  namespace?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
