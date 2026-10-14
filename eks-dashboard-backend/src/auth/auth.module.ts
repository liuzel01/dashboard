import { forwardRef, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MfaVerificationService } from './mfa-verification.service';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AccessControlModule } from '../access-control/access-control.module';
import { SiteConfModule } from '../site-conf/site-conf.module';

@Module({
  imports: [AccessControlModule, forwardRef(() => SiteConfModule)],
  providers: [AuthService, MfaVerificationService],
  controllers: [AuthController, MeController],
  exports: [AuthService, MfaVerificationService],
})
export class AuthModule {}
