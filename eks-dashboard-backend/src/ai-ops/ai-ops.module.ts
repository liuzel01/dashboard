import { Module } from '@nestjs/common';
import { AiOpsController } from './ai-ops.controller';
import { AiOpsService } from './ai-ops.service';
import { DatabaseModule } from '../database/database.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { AiOpsLogService } from './ai-ops-log.service';
import { AiOpsInvestigationService } from './ai-ops-investigation.service';
import { AiOpsAlertInvestigationService } from './ai-ops-alert-investigation.service';
import { AiOpsPrometheusEvidenceService } from './ai-ops-prometheus-evidence.service';
import { AiOpsContextEvidenceService } from './ai-ops-context-evidence.service';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { OncallModule } from '../oncall/oncall.module';
import { AiOpsGroupCallbackService } from './ai-ops-group-callback.service';
import { AiOpsGrafanaMcpService } from './ai-ops-grafana-mcp.service';
import { AiOpsAlertAgentService } from './ai-ops-alert-agent.service';

@Module({
  imports: [
    DatabaseModule,
    AccessControlModule,
    AuthModule,
    EnvironmentsModule,
    SiteConfModule,
    KubernetesModule,
    OncallModule,
  ],
  controllers: [AiOpsController],
  providers: [
    AiOpsService,
    AiOpsLogService,
    AiOpsInvestigationService,
    AiOpsAlertInvestigationService,
    AiOpsPrometheusEvidenceService,
    AiOpsContextEvidenceService,
    AiOpsGroupCallbackService,
    AiOpsGrafanaMcpService,
    AiOpsAlertAgentService,
  ],
})
export class AiOpsModule {}
