import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [AccessControlModule, AuthModule, SiteConfModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
