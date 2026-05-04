import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ListIngressSourceCandidatesDto {
  @IsString()
  @IsNotEmpty()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  namespace!: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
