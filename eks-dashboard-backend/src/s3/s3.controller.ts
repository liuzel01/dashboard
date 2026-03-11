import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  ValidationPipe,
} from '@nestjs/common';
import type { Multer } from 'multer';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Service } from './s3.service';
import { EnvironmentsService } from '../environments/environments.service';

class ObjectExistsDto {
  bucket!: string;
  key!: string;
}

class UploadDto {
  bucket!: string;
  key!: string;
}

@Controller('s3')
export class S3Controller {
  constructor(
    private readonly s3Service: S3Service,
    private readonly environmentsService: EnvironmentsService,
  ) {}

  private requireEnvironment(environmentId?: string) {
    if (!environmentId) {
      throw new BadRequestException('Header "X-Target-Environment" is required.');
    }
    return environmentId;
  }

  private toErrorMessage(err: any) {
    const name = err?.name ? String(err.name) : 'S3Error';
    const msg = err?.message ? String(err.message) : 'Unknown error';
    return `${name}: ${msg}`;
  }

  @Get('buckets')
  async listBuckets(@Headers('x-target-environment') environmentId?: string) {
    const envId = this.requireEnvironment(environmentId);
    const env = this.environmentsService.getEnvironmentById(envId);
    if (!env?.aws_region) {
      throw new BadRequestException(`Environment "${envId}" missing aws_region`);
    }
    try {
      const buckets = await this.s3Service.listBuckets(envId, env.aws_region);
      return { region: env.aws_region, buckets };
    } catch (err: any) {
      throw new BadRequestException(this.toErrorMessage(err));
    }
  }

  @Post('object-exists')
  async objectExists(
    @Body(new ValidationPipe({ transform: true })) body: ObjectExistsDto,
    @Headers('x-target-environment') environmentId: string,
  ) {
    const envId = this.requireEnvironment(environmentId);
    if (!body.bucket || !body.key) {
      throw new BadRequestException('bucket and key are required');
    }
    try {
      const exists = await this.s3Service.objectExists(envId, body.bucket, body.key);
      return { exists };
    } catch (err: any) {
      throw new BadRequestException(this.toErrorMessage(err));
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Body(new ValidationPipe({ transform: true })) body: UploadDto,
    @Headers('x-target-environment') environmentId: string,
    @UploadedFile() file?: Multer.File,
  ) {
    const envId = this.requireEnvironment(environmentId);
    if (!body.bucket || !body.key) {
      throw new BadRequestException('bucket and key are required');
    }
    if (!file) {
      throw new BadRequestException('file is required');
    }
    try {
      const result = await this.s3Service.uploadObject(envId, body.bucket, body.key, file);
      return { ok: true, ...result };
    } catch (err: any) {
      throw new BadRequestException(this.toErrorMessage(err));
    }
  }
}
