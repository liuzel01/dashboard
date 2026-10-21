import { forwardRef, Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { AwsCredentialProviderFactory } from './aws-credential-provider.factory';
import { AwsDetectionService } from './aws-detection.service';
import { AwsGovernanceCollector } from './aws-governance.collector';
import { AwsGovernanceController } from './aws-governance.controller';
import { AwsGovernanceService } from './aws-governance.service';

@Module({
  imports: [
    AccessControlModule,
    AuditModule,
    SiteConfModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AwsGovernanceController],
  providers: [
    AwsCredentialProviderFactory,
    AwsGovernanceCollector,
    AwsDetectionService,
    AwsGovernanceService,
  ],
  exports: [AwsCredentialProviderFactory],
})
export class AwsGovernanceModule {}
