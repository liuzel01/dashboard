import { IsNotEmpty, IsString } from 'class-validator';

export class ListCasCertificatesDto {
  @IsString()
  @IsNotEmpty()
  rootDomain!: string;
}

