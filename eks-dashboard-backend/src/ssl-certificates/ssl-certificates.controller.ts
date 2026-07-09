import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query, Res, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength, IsInt, Min } from 'class-validator';
import { SslCertificatesService } from './ssl-certificates.service';

class ListSslCertificatesDto {
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

class SensitiveCertificateActionDto {
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

  @Get(':id')
  async detail(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.getCertificateDetail(actor, id, this.getReqMeta(headers));
  }

  @Post(':id/export-encrypted')
  async exportEncrypted(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Param('id', ParseIntPipe) id: number,
    @Body(validation) body: SensitiveCertificateActionDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.exportEncryptedPackage(actor, id, body, this.getReqMeta(headers));
  }

  @Post(':id/decrypt-download')
  async decryptDownload(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, any>,
    @Param('id', ParseIntPipe) id: number,
    @Body(validation) body: SensitiveCertificateActionDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createDecryptedDownload(actor, id, body, this.getReqMeta(headers));
  }

  @Get('download/:token')
  async download(
    @Headers('authorization') authorization: string | undefined,
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    const session = this.service.consumeDownloadToken(actor, token);
    res.setHeader('Content-Type', session.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${session.filename}"`);
    return res.send(session.payload);
  }
}
