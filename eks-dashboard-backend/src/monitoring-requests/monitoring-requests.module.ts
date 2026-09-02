import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { MonitoringRequestsController } from './monitoring-requests.controller';
import { MonitoringRequestsService } from './monitoring-requests.service';

@Module({
  imports: [AccessControlModule, AuthModule],
  controllers: [MonitoringRequestsController],
  providers: [MonitoringRequestsService],
})
export class MonitoringRequestsModule {}
