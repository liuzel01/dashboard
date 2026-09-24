import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class MfaCodeDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Google 验证码必须是 6 位数字' })
  otpCode!: string;
}
