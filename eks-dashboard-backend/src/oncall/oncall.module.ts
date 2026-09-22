import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { OncallController } from './oncall.controller';
import { OncallService } from './oncall.service';

@Module({
  imports: [AccessControlModule, AuditModule, AuthModule],
  controllers: [OncallController],
  providers: [OncallService],
  exports: [OncallService],
})
export class OncallModule {}
