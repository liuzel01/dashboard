import { Body, Controller, Delete, Get, Param, Patch, Post, Put, ValidationPipe } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly service: AccessControlService) {}

  @Get()
  list() {
    return this.service.listRoles();
  }

  @Post()
  create(@Body(new ValidationPipe({ transform: true })) body: CreateRoleDto) {
    return this.service.createRole(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateRoleDto,
  ) {
    return this.service.updateRole(Number(id), body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.deleteRole(Number(id));
  }

  @Put(':id/permissions')
  updatePermissions(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateRolePermissionsDto,
  ) {
    return this.service.updateRolePermissions(Number(id), body);
  }
}
