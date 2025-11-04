import { Module } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { EnvironmentsController } from './environments.controller';
import { EnvironmentsDbService } from './environments.db.service';
import { CentralDatabaseService } from '../site-monitor/central-database.service';

@Module({
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService, EnvironmentsDbService, CentralDatabaseService],
  exports: [EnvironmentsService], // 导出服务，以便其他模块可以使用
})
export class EnvironmentsModule {}
