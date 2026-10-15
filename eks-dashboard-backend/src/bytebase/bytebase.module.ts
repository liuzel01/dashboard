import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { SiteConfModule } from '../site-conf/site-conf.module';
import { BytebaseController } from './bytebase.controller';
import { BytebaseEventsGateway } from './bytebase-events.gateway';
import { BytebaseReconcilerService } from './bytebase-reconciler.service';
import { BytebaseService } from './bytebase.service';

@Module({
  imports: [AccessControlModule, AuthModule, SiteConfModule],
  controllers: [BytebaseController],
  providers: [
    BytebaseService,
    BytebaseEventsGateway,
    BytebaseReconcilerService,
  ],
})
export class BytebaseModule {}
