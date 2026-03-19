import { IsNotEmpty, IsString } from 'class-validator';
import { IsOptional } from 'class-validator';

export class ListCasCertificatesDto {
  @IsString()
  @IsNotEmpty()
  rootDomain!: string;

  @IsOptional()
  @IsString()
  targetDomain?: string;
}
