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

@Module({
  imports: [
    DatabaseModule,
    AccessControlModule,
    AuthModule,
    EnvironmentsModule,
    SiteConfModule,
    KubernetesModule,
  ],
  controllers: [AiOpsController],
  providers: [
    AiOpsService,
    AiOpsLogService,
    AiOpsInvestigationService,
    AiOpsAlertInvestigationService,
    AiOpsPrometheusEvidenceService,
    AiOpsContextEvidenceService,
  ],
})
export class AiOpsModule {}
