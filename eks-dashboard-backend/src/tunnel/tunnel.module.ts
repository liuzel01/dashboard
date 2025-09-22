import { Module } from '@nestjs/common';
import { TunnelService } from './tunnel.service';
import { TunnelManagerService } from './tunnel-manager.service';
import { EnvironmentsModule } from '../environments/environments.module';

@Module({
  imports: [EnvironmentsModule],
  providers: [TunnelService, TunnelManagerService],
  exports: [TunnelService, TunnelManagerService],
})
export class TunnelModule {}
