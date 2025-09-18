import { IsEmail, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  // Allow empty string to signify clearing the value, which the service will convert to null.
  email?: string | null; // After transform, this will be string or null

  @IsOptional()
  @IsString()
  // Allow empty string to signify clearing the value.
  tel?: string | null;

  @IsOptional()
  @IsString()
  tel_country_code?: string | null;
}
