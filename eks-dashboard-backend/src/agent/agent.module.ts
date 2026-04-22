import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './agent.controller';
import { AgentConfigService } from './agent-config.service';
import { AgentDecryptService } from './agent-decrypt.service';
import { AgentConnectionService } from './agent-connection.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [AgentController],
  providers: [AgentConfigService, AgentDecryptService, AgentConnectionService],
})
export class AgentModule {}

