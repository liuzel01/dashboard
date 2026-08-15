import { Body, Controller, Delete, Get, Param, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ListSiteConfDto, UpsertSiteConfDto } from './dto/site-conf.dto';
import { SiteConfService } from './site-conf.service';

@Controller('site-conf')
export class SiteConfController {
  constructor(private readonly siteConfService: SiteConfService) {}

  @Get('/runtime-config')
  runtimeConfig() {
    return this.siteConfService.getPublicRuntimeConfig();
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  list(@Query() query: ListSiteConfDto) {
    return this.siteConfService.list(query);
  }

  @Get('categories')
  categories() {
    return this.siteConfService.categories();
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  upsert(@Body() body: UpsertSiteConfDto) {
    return this.siteConfService.upsert(body);
  }

  @Delete(':confKey')
  remove(@Param('confKey') confKey: string) {
    return this.siteConfService.remove(confKey);
  }
}
