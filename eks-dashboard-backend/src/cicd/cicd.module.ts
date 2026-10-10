import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { CicdCatalogController } from './cicd-catalog.controller';
import { CicdCatalogService } from './cicd-catalog.service';
import { CicdRunsController } from './cicd-runs.controller';
import { CicdRunsService } from './cicd-runs.service';

@Module({
  imports: [AccessControlModule, AuthModule, SiteConfModule],
  controllers: [CicdCatalogController, CicdRunsController],
  providers: [CicdCatalogService, CicdRunsService],
})
export class CicdModule {}
