import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SiteMonitorService } from './site-monitor.service';
import { SiteMonitorController } from './site-monitor.controller';
import { CentralDatabaseService } from './central-database.service';
import { MonitorScheduler } from './monitor.scheduler';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { EnvironmentsModule } from '../environments/environments.module';

@Module({
  imports: [ScheduleModule.forRoot(), EnvironmentsModule],
  providers: [CentralDatabaseService, SiteMonitorService, MonitorScheduler, AlertsService],
  controllers: [SiteMonitorController, AlertsController],
  exports: [CentralDatabaseService],
})
export class SiteMonitorModule {}
