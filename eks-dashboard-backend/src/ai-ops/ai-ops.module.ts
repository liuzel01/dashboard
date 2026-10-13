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

@Module({
  imports: [
    DatabaseModule,
    AccessControlModule,
    AuthModule,
    EnvironmentsModule,
    SiteConfModule,
  ],
  controllers: [AiOpsController],
  providers: [
    AiOpsService,
    AiOpsLogService,
    AiOpsInvestigationService,
    AiOpsAlertInvestigationService,
  ],
})
export class AiOpsModule {}
