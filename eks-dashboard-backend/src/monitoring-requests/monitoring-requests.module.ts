import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { MonitoringRequestsController } from './monitoring-requests.controller';
import { MonitoringRequestsService } from './monitoring-requests.service';

@Module({
  imports: [AccessControlModule, AuthModule, SiteConfModule, KubernetesModule],
  controllers: [MonitoringRequestsController],
  providers: [MonitoringRequestsService],
})
export class MonitoringRequestsModule {}
