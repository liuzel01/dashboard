import { Body, Controller, Get, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { LinesService } from './lines.service';
import { ListLineDto } from './dto/list-line.dto';
import { VerifyExternalLineDto } from './dto/verify-external-line.dto';
import { ProvisionDcdnDomainDto } from './dto/provision-dcdn-domain.dto';
import { GetDcdnDomainStatusDto } from './dto/get-dcdn-domain-status.dto';
import { ApplyDcdnSecurityDto } from './dto/apply-dcdn-security.dto';
import { ListCasCertificatesDto } from './dto/list-cas-certificates.dto';

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

  @Get('dcdn/status')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  getDcdnStatus(@Query() query: GetDcdnDomainStatusDto) {
    return this.linesService.getDcdnDomainStatus(query.domainName);
  }

  @Post('dcdn/security/apply')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  applyDcdnSecurity(@Body() body: ApplyDcdnSecurityDto) {
    return this.linesService.applyDcdnSecurity(body);
  }

  @Get('dcdn/cas-certificates')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listCasCertificates(@Query() query: ListCasCertificatesDto) {
    return this.linesService.listCasCertificates(query.rootDomain);
  }
}
