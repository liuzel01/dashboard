import { Body, Controller, Get, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { LinesService } from './lines.service';
import { ListLineDto } from './dto/list-line.dto';
import { VerifyExternalLineDto } from './dto/verify-external-line.dto';
import { ProvisionDcdnDomainDto } from './dto/provision-dcdn-domain.dto';

@Controller('lines')
export class LinesController {
  constructor(private readonly linesService: LinesService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: ListLineDto) {
    return this.linesService.getLines(query);
  }

  @Get('external/check')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  checkExternal(@Query() query: VerifyExternalLineDto) {
    return this.linesService.verifyLineByExternalApi(query.lineUrl);
  }

  @Post('dcdn/provision')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  provisionDcdn(@Body() body: ProvisionDcdnDomainDto) {
    return this.linesService.provisionDcdnDomain(body);
  }
}
