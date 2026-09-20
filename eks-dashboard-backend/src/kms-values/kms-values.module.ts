import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { KmsValuesController } from './kms-values.controller';
import { KmsValuesService } from './kms-values.service';

@Module({
  imports: [AccessControlModule, AuditModule, AuthModule, EnvironmentsModule],
  controllers: [KmsValuesController],
  providers: [KmsValuesService],
})
export class KmsValuesModule {}
