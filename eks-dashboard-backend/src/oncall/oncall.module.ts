import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OncallController } from './oncall.controller';
import { OncallNotificationService } from './oncall-notification.service';
import { OncallService } from './oncall.service';
import { OncallEscalationService } from './oncall-escalation.service';
import { HotlineService } from './hotline.service';

@Module({
  imports: [AccessControlModule, AuditModule, AuthModule],
  controllers: [OncallController],
  providers: [OncallService, OncallNotificationService, OncallEscalationService, HotlineService],
  exports: [OncallService],
})
export class OncallModule {}
