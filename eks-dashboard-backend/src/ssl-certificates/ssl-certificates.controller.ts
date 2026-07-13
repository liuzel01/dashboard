import { Body, Controller, Get, Headers, Post, Query, Res, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, IsInt, Min } from 'class-validator';

class RequestSslCertificateDto {
  @IsString()
  @MaxLength(128)
  environmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsString()
  @MaxLength(253)
  domain!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  sans?: string;
}
import { SslCertificatesService } from './ssl-certificates.service';

class ListSslCertificatesDto {
  @IsString()
  @MaxLength(128)
  environmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

class GetSslCertificateDetailDto {
  @IsString()
  @MaxLength(128)
  environmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsString()
  @MaxLength(2048)
  certificateArn!: string;
}

class SensitiveCertificateActionDto {
  @IsString()
  @MaxLength(128)
  environmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  region?: string;

  @IsString()
  @MaxLength(2048)
  certificateArn!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(12)
  otpCode!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  passphrase!: string;
}

const validation = new ValidationPipe({ transform: true, whitelist: true });

@Controller('ssl-certificates')
export class SslCertificatesController {
  constructor(private readonly service: SslCertificatesService) {}

  private getReqMeta(headers: Record<string, any>) {
    const forwarded = headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string' && forwarded.trim()
        ? forwarded.split(',')[0].trim()
        : null;
    return {
      ip,
      userAgent: String(headers['user-agent'] || '') || null,
    };
  }

  @Get()
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListSslCertificatesDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listCertificates(actor, query);
  }

  @Get('detail')
  async detail(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Query(validation) query: GetSslCertificateDetailDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.getCertificateDetail(actor, query, this.getReqMeta(headers));
  }

  @Post('request-certificate')
  async requestCertificate(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Body(validation) body: RequestSslCertificateDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.requestCertificate(actor, body, this.getReqMeta(headers));
  }

  @Post('export-encrypted')
  async exportEncrypted(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Body(validation) body: SensitiveCertificateActionDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.exportEncryptedPackage(actor, body, this.getReqMeta(headers));
  }

  @Post('decrypt-download')
  async decryptDownload(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Body(validation) body: SensitiveCertificateActionDto,
    @Res() res: Response,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    const file = await this.service.createDecryptedDownload(actor, body, this.getReqMeta(headers));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return res.send(file.payload);
  }
}
