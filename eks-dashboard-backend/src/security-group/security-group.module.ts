import { Module } from '@nestjs/common';
import { SecurityGroupController } from './security-group.controller';
import { SecurityGroupService } from './security-group.service';
import { EnvironmentsModule } from '../environments/environments.module';

@Module({
  imports: [EnvironmentsModule],
  controllers: [SecurityGroupController],
  providers: [SecurityGroupService],
})
export class SecurityGroupModule {}
