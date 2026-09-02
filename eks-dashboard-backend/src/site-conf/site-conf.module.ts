import { forwardRef, Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { CentralDatabaseService } from '../site-monitor/central-database.service';
import { SiteConfController } from './site-conf.controller';
import { SiteConfService } from './site-conf.service';

@Module({
  imports: [AccessControlModule, forwardRef(() => AuthModule)],
  controllers: [SiteConfController],
  providers: [SiteConfService, CentralDatabaseService],
  exports: [SiteConfService],
})
export class SiteConfModule {}
