import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyExternalLineDto {
  @IsString()
  @IsNotEmpty()
  lineUrl!: string;
}
