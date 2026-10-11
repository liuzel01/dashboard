import { Body, Controller, Delete, ForbiddenException, Get, Headers, Put } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { MenuOrderService } from './menu-order.service';

@Controller('menu-order')
export class MenuOrderController {
  constructor(private readonly menuOrder: MenuOrderService, private readonly auth: AuthService) {}

  @Get()
  async get(@Headers('authorization') authorization?: string) {
    await this.auth.resolveCurrentUser(authorization);
    return this.menuOrder.get();
  }

  @Put()
  async update(@Headers('authorization') authorization: string | undefined, @Body() body: { groups?: unknown }) {
    const user = await this.requireMenuAdmin(authorization);
    return this.menuOrder.update(body?.groups, Number(user.id));
  }

  @Delete()
  async reset(@Headers('authorization') authorization?: string) {
    await this.requireMenuAdmin(authorization);
    return this.menuOrder.reset();
  }

  private async requireMenuAdmin(authorization?: string) {
    const user = await this.auth.requireAdminCurrentUser(authorization);
    if (!(user.permissions || []).includes('menu:menu-management')) {
      throw new ForbiddenException('缺少权限：menu:menu-management');
    }
    return user;
  }
}
