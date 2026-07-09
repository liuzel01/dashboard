import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { SslCertificatesController } from './ssl-certificates.controller';
import { SslCertificatesService } from './ssl-certificates.service';

@Module({
  imports: [AccessControlModule, AuthModule, AuditModule, SiteConfModule],
  controllers: [SslCertificatesController],
  providers: [SslCertificatesService],
})
export class SslCertificatesModule {}
