import { Module } from '@nestjs/common';
import { SiteMonitorModule } from '../site-monitor/site-monitor.module';
import { SiteConfController } from './site-conf.controller';
import { SiteConfService } from './site-conf.service';

@Module({
  imports: [SiteMonitorModule],
  controllers: [SiteConfController],
  providers: [SiteConfService],
  exports: [SiteConfService],
})
export class SiteConfModule {}
