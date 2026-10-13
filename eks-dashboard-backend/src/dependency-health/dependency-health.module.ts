import { forwardRef, Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { DependencyHealthController } from './dependency-health.controller';
import { DependencyHealthService } from './dependency-health.service';

@Module({
  imports: [SiteConfModule, AccessControlModule, forwardRef(() => AuthModule)],
  controllers: [DependencyHealthController],
  providers: [DependencyHealthService],
})
export class DependencyHealthModule {}
