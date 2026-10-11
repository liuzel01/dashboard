import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { MenuOrderController } from './menu-order.controller';
import { MenuOrderService } from './menu-order.service';

@Module({
  imports: [AccessControlModule, AuthModule],
  controllers: [MenuOrderController],
  providers: [MenuOrderService],
  exports: [MenuOrderService],
})
export class MenuOrderModule {}
