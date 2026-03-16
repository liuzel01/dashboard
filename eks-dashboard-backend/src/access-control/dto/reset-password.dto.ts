import { IsOptional, IsString } from 'class-validator';

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  password?: string;
}
