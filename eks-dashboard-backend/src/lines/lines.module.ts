import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { IngressGatewayClientService } from './ingress-gateway-client.service';
import { LineOnboardingGatewayClientService } from './line-onboarding-gateway-client.service';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { CentralDatabaseService } from '../site-monitor/central-database.service';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';

@Module({
  imports: [HttpModule, KubernetesModule, EnvironmentsModule, SiteConfModule, AuthModule, AccessControlModule],
  controllers: [LinesController],
  providers: [
    LinesService,
    IngressGatewayClientService,
    LineOnboardingGatewayClientService,
    CentralDatabaseService,
  ],
  exports: [LinesService],
})
export class LinesModule {}
