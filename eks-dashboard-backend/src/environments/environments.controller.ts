import { Controller, Get, Param } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';

@Controller('environments')
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Get()
  findAll() {
    return this.environmentsService.getEnvironments();
  }

  @Get(':id/tenants')
  findTenants(@Param('id') id: string) {
    return this.environmentsService.getTenantsForEnvironment(id);
  }
}
