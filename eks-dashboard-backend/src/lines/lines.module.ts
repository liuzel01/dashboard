import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { SiteMonitorModule } from '../site-monitor/site-monitor.module';
import { IngressGatewayClientService } from './ingress-gateway-client.service';
import { LineOnboardingGatewayClientService } from './line-onboarding-gateway-client.service';

@Module({
  imports: [HttpModule, KubernetesModule, SiteMonitorModule],
  controllers: [LinesController],
  providers: [LinesService, IngressGatewayClientService, LineOnboardingGatewayClientService],
})
export class LinesModule {}
