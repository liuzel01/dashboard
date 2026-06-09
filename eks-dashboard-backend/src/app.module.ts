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
import { RedisModule } from './redis/redis.module';
import { TunnelModule } from './tunnel/tunnel.module';
import { LogsModule } from './logs/logs.module';
import { LinesModule } from './lines/lines.module';
import { SiteMonitorModule } from './site-monitor/site-monitor.module';
import { S3Module } from './s3/s3.module';
import { AccessControlModule } from './access-control/access-control.module';
import { AuthModule } from './auth/auth.module';
import { AiOpsModule } from './ai-ops/ai-ops.module';
import { AuditModule } from './audit/audit.module';
import { CertStudyModule } from './cert-study/cert-study.module';
import { AssetsModule } from './assets/assets.module';

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
    RedisModule,
    TunnelModule,
    LogsModule,
    LinesModule,
    SiteMonitorModule,
    S3Module,
    AccessControlModule,
    AuthModule,
    AiOpsModule,
    AuditModule,
    CertStudyModule,
    AssetsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
