import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OncallController } from './oncall.controller';
import { OncallNotificationService } from './oncall-notification.service';
import { OncallService } from './oncall.service';

@Module({
  imports: [AccessControlModule, AuditModule, AuthModule],
  providers: [OncallService, OncallNotificationService],
  exports: [OncallService],
})
export class OncallCoreModule {}

@Module({
  imports: [OncallCoreModule],
  controllers: [OncallController],
})
export class OncallModule {}
