import { forwardRef, Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AwsGovernanceModule } from '../aws-governance/aws-governance.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { AwsAccessController } from './aws-access.controller';
import { AwsAccessService } from './aws-access.service';

@Module({
  imports: [
    AccessControlModule,
    AuditModule,
    SiteConfModule,
    AwsGovernanceModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AwsAccessController],
  providers: [AwsAccessService],
})
export class AwsAccessModule {}
