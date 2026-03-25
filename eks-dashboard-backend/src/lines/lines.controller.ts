import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { LinesService } from './lines.service';
import { ListLineDto } from './dto/list-line.dto';
import { VerifyExternalLineDto } from './dto/verify-external-line.dto';
import { ProvisionDcdnDomainDto } from './dto/provision-dcdn-domain.dto';
import { GetDcdnDomainStatusDto } from './dto/get-dcdn-domain-status.dto';
import { ApplyDcdnSecurityDto } from './dto/apply-dcdn-security.dto';
import { ListCasCertificatesDto } from './dto/list-cas-certificates.dto';
import { RegisterSuperAdminLineDto } from './dto/register-super-admin-line.dto';
import { ListSuperAdminLinesDto } from './dto/list-super-admin-lines.dto';
import { ListIngressOriginCandidatesDto } from './dto/list-ingress-origin-candidates.dto';

@Controller('lines')
export class LinesController {
  constructor(private readonly linesService: LinesService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(
    @Headers('x-target-environment') environmentId: string,
    @Query() query: ListLineDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.getLines(environmentId, query);
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
    return this.linesService.listCasCertificates(query.rootDomain, query.targetDomain);
  }

  @Post('super-admin/register')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  registerSuperAdminLine(
    @Headers('x-target-environment') environmentId: string,
    @Body() body: RegisterSuperAdminLineDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.registerSuperAdminLine(environmentId, body);
  }

  @Get('super-admin/list')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listSuperAdminLines(
    @Headers('x-target-environment') environmentId: string,
    @Query() query: ListSuperAdminLinesDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.listSuperAdminLines(environmentId, query);
  }

  @Get('ingress/origin-candidates')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listIngressOriginCandidates(
    @Headers('x-target-environment') environmentId: string,
    @Query() query: ListIngressOriginCandidatesDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.listIngressOriginCandidates(environmentId, query.keyword);
  }
}
