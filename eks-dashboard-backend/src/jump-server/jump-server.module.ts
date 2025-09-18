import { Module } from '@nestjs/common';
import { JumpServerController } from './jump-server.controller';
import { JumpServerService } from './jump-server.service';
import { EnvironmentsModule } from '../environments/environments.module';
@Module({
  imports: [EnvironmentsModule], // 导入 EnvironmentsModule
  controllers: [JumpServerController],
  providers: [JumpServerService],
})
export class JumpServerModule {}
