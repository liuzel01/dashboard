import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AccessControlModule } from '../access-control/access-control.module';

@Module({
  imports: [AccessControlModule],
  providers: [AuthService],
  controllers: [AuthController, MeController],
  exports: [AuthService],
})
export class AuthModule {}
