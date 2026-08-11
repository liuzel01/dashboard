import { Module } from '@nestjs/common';
import { CentralDatabaseService } from '../site-monitor/central-database.service';
import { SiteConfController } from './site-conf.controller';
import { SiteConfService } from './site-conf.service';

@Module({
  controllers: [SiteConfController],
  providers: [SiteConfService, CentralDatabaseService],
  exports: [SiteConfService],
})
export class SiteConfModule {}
