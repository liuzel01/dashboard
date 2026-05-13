import { Module } from '@nestjs/common';
import { CertStudyController } from './cert-study.controller';
import { CertStudyService } from './cert-study.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AccessControlModule, AuthModule],
  controllers: [CertStudyController],
  providers: [CertStudyService],
})
export class CertStudyModule {}
