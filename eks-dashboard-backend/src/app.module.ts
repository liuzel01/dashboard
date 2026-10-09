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
import { SiteConfModule } from './site-conf/site-conf.module';
import { SslCertificatesModule } from './ssl-certificates/ssl-certificates.module';
import { MonitoringRequestsModule } from './monitoring-requests/monitoring-requests.module';
import { KmsValuesModule } from './kms-values/kms-values.module';
import { OncallModule } from './oncall/oncall.module';
import { CicdModule } from './cicd/cicd.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 使 ConfigModule 在全局可用
      envFilePath: ['.env', '.env.local', '.env.development', '.env-example'], // dev fallback
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
    SiteConfModule,
    SslCertificatesModule,
    MonitoringRequestsModule,
    KmsValuesModule,
    OncallModule,
    CicdModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
