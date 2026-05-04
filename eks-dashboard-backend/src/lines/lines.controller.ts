import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
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
import { ListLineInventoryDto } from './dto/list-line-inventory.dto';
import { CloneIngressDto } from './dto/clone-ingress.dto';
import { ResolveIngressSourceDto } from './dto/resolve-ingress-source.dto';
import { ListIngressSourceCandidatesDto } from './dto/list-ingress-source-candidates.dto';
import { ApplyTenantDomainDto } from './dto/apply-tenant-domain.dto';

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

  @Get('inventory')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  getInventory(
    @Headers('x-target-environment') environmentId: string,
    @Query() query: ListLineInventoryDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.getLineInventory(environmentId, query);
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

  @Post('tenant-domain/apply')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  applyTenantDomain(
    @Headers('x-target-environment') environmentId: string,
    @Req() req: any,
    @Body() body: ApplyTenantDomainDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.environmentId && body.environmentId !== environmentId) {
      throw new HttpException('environmentId mismatch with X-Target-Environment', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.applyTenantDomain(environmentId, {
      tenantId: body.tenantId,
      domain: body.domain,
      requestId: req?.requestId,
      userId: req?.user?.id ? String(req.user.id) : undefined,
      username: req?.user?.username,
    });
  }

  @Post('ingress/source-candidates')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listIngressSourceCandidates(
    @Headers('x-target-environment') environmentId: string,
    @Req() req: any,
    @Body() body: ListIngressSourceCandidatesDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.environmentId && body.environmentId !== environmentId) {
      throw new HttpException('environmentId mismatch with X-Target-Environment', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.listIngressSourceCandidates(environmentId, {
      namespace: body.namespace,
      keyword: body.keyword,
      requestId: req?.requestId,
      userId: req?.user?.id ? String(req.user.id) : undefined,
      username: req?.user?.username,
    });
  }

  @Post('ingress/resolve-source')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  resolveIngressSource(
    @Headers('x-target-environment') environmentId: string,
    @Req() req: any,
    @Body() body: ResolveIngressSourceDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.environmentId && body.environmentId !== environmentId) {
      throw new HttpException('environmentId mismatch with X-Target-Environment', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.resolveIngressSource(environmentId, {
      namespace: body.namespace,
      lineUrl: body.lineUrl,
      keyword: body.keyword,
      requestId: req?.requestId,
      userId: req?.user?.id ? String(req.user.id) : undefined,
      username: req?.user?.username,
    });
  }

  @Post('ingress/clone')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  cloneIngress(
    @Headers('x-target-environment') environmentId: string,
    @Req() req: any,
    @Body() body: CloneIngressDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.environmentId && body.environmentId !== environmentId) {
      throw new HttpException('environmentId mismatch with X-Target-Environment', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.cloneIngressFromTemplate(environmentId, {
      namespace: body.namespace,
      sourceIngressName: body.sourceIngressName,
      newHost: body.newHost,
      newIngressName: body.newIngressName,
      requestId: req?.requestId,
      userId: req?.user?.id ? String(req.user.id) : undefined,
      username: req?.user?.username,
    });
  }
}
