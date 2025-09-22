import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { EnvironmentsModule } from '../environments/environments.module';
import { TunnelModule } from '../tunnel/tunnel.module';

@Module({
  imports: [EnvironmentsModule, TunnelModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
