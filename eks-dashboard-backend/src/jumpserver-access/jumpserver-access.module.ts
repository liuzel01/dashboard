import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { JumpserverAccessController } from './jumpserver-access.controller';
import { JumpserverAccessService } from './jumpserver-access.service';
@Module({
  imports: [AccessControlModule, AuthModule, SiteConfModule],
  controllers: [JumpserverAccessController],
  providers: [JumpserverAccessService],
})
export class JumpserverAccessModule {}
