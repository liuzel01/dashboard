import { Module } from '@nestjs/common';
import { AiOpsController } from './ai-ops.controller';
import { AiOpsService } from './ai-ops.service';
import { DatabaseModule } from '../database/database.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { SiteConfModule } from '../site-conf/site-conf.module';

@Module({
  imports: [DatabaseModule, AccessControlModule, AuthModule, EnvironmentsModule, SiteConfModule],
  controllers: [AiOpsController],
  providers: [AiOpsService],
})
export class AiOpsModule {}
