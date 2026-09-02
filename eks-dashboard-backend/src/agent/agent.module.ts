import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent.controller';
import { AgentConfigService } from './agent-config.service';
import { AgentDecryptService } from './agent-decrypt.service';
import { AgentConnectionService } from './agent-connection.service';
import { AgentQueryService } from './agent-query.service';
import { AgentIngressService } from './agent-ingress.service';
import { AgentTenantDomainService } from './agent-tenant-domain.service';
import { AgentMetricsService } from './agent-metrics.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [AgentController],
  providers: [
    AgentConfigService,
    AgentDecryptService,
    AgentConnectionService,
    AgentQueryService,
    AgentIngressService,
    AgentTenantDomainService,
    AgentMetricsService,
  ],
})
export class AgentModule {}
