import { Module } from '@nestjs/common';
import { EnvironmentsModule } from '../environments/environments.module';
import { S3Controller } from './s3.controller';
import { S3Service } from './s3.service';

@Module({
  imports: [EnvironmentsModule],
  controllers: [S3Controller],
  providers: [S3Service],
})
export class S3Module {}
