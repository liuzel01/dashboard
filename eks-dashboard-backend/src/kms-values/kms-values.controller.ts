import { Body, Controller, Get, Headers, Post, Query, ValidationPipe } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { KmsValuesService } from './kms-values.service';

class EncryptValueDto {
  @IsString() @MaxLength(128) environmentId!: string;
  @IsString() @MinLength(1) @MaxLength(4096) value!: string;
}
class DecryptValueDto {
  @IsString() @MaxLength(128) environmentId!: string;
  @IsString() @MinLength(10) @MaxLength(16384) value!: string;
  @IsString() @MinLength(6) @MaxLength(12) otpCode!: string;
}
class KmsConfigurationQueryDto {
  @IsString() @MaxLength(128) environmentId!: string;
}
const validation = new ValidationPipe({ transform: true, whitelist: true });

@Controller('kms-values')
export class KmsValuesController {
  constructor(private readonly service: KmsValuesService) {}
  private meta(headers: Record<string, any>) {
    const forwarded = headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' && forwarded.trim() ? forwarded.split(',')[0].trim() : null;
    return { ip, userAgent: String(headers['user-agent'] || '') || null };
  }
  @Get('config')
  async configuration(@Headers('authorization') authorization: string | undefined, @Query(validation) query: KmsConfigurationQueryDto) {
    await this.service.resolveActorFromAuthorization(authorization);
    return this.service.getConfiguration(query.environmentId);
  }
  @Post('encrypt')
  async encrypt(@Headers('authorization') authorization: string | undefined, @Headers() headers: Record<string, any>, @Body(validation) body: EncryptValueDto) {
    return this.service.encrypt(await this.service.resolveActorFromAuthorization(authorization), body, this.meta(headers));
  }
  @Post('decrypt')
  async decrypt(@Headers('authorization') authorization: string | undefined, @Headers() headers: Record<string, any>, @Body(validation) body: DecryptValueDto) {
    return this.service.decrypt(await this.service.resolveActorFromAuthorization(authorization), body, this.meta(headers));
  }
}
