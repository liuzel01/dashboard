import { IsNotEmpty, IsString } from 'class-validator';

export class GetDcdnDomainStatusDto {
  @IsString()
  @IsNotEmpty()
  domainName!: string;
}
