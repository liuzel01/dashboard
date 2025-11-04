import { Body, Controller, Delete, Get, Headers, HttpException, HttpStatus, Param, ParseIntPipe, Post, Query, Patch } from '@nestjs/common';
import { SiteMonitorService } from './site-monitor.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

@Controller('site-monitors')
export class SiteMonitorController {
  constructor(private readonly service: SiteMonitorService) {}

  @Get()
  async list(
    @Headers('x-target-environment') environmentId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const tenantIdNum = tenantId !== undefined ? Number(tenantId) : undefined;
    return this.service.listSites(environmentId, tenantIdNum);
  }

  @Post()
  async create(
    @Headers('x-target-environment') environmentId: string,
    @Body() dto: CreateSiteDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.service.createSite(environmentId, dto);
    } catch (e: any) {
      const msg = e?.message || String(e);
      throw new HttpException(`Failed to create site: ${msg}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete(':id')
  async remove(
    @Headers('x-target-environment') environmentId: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.service.deleteSite(environmentId, id);
  }

  @Post(':id/check')
  async check(
    @Headers('x-target-environment') environmentId: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.service.checkSite(environmentId, id);
  }

  @Patch(':id')
  async update(
    @Headers('x-target-environment') environmentId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSiteDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.service.updateSite(environmentId, id, dto);
  }

  @Get(':id')
  async getOne(
    @Headers('x-target-environment') environmentId: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.service.getSiteById(environmentId, id);
  }
}
