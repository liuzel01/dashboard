import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JumpServerModule } from './jump-server/jump-server.module';
import { KubernetesModule } from './kubernetes/kubernetes.module';
import { DeploymentsModule } from './deployments/deployments.module';
import { EnvironmentsModule } from './environments/environments.module';
import { QueryModule } from './query/query.module';
import { DatabaseModule } from './database/database.module';
import { SecurityGroupModule } from './security-group/security-group.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 使 ConfigModule 在全局可用
      envFilePath: '.env', // 指定 .env 文件的路径
    }),
    JumpServerModule,
    KubernetesModule,
    DeploymentsModule,
    EnvironmentsModule,
    QueryModule,
    DatabaseModule,
    SecurityGroupModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
