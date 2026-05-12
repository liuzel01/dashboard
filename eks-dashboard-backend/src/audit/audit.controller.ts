import { Controller, Get, Post, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('username') username?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('environmentId') environmentId?: string,
    @Query('action') action?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.audit.list({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      startTime,
      endTime,
      username,
      method,
      status,
      environmentId,
      action,
      keyword,
    });
  }

  @Post('cleanup')
  cleanup() {
    return this.audit.cleanupOlderThan(90);
  }
}
