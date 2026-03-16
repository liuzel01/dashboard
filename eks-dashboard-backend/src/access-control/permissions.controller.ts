import { Controller, Get } from '@nestjs/common';
import { AccessControlService } from './access-control.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly service: AccessControlService) {}

  @Get()
  list() {
    return this.service.listPermissions();
  }
}
