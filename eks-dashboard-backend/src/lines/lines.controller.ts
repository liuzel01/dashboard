import { Body, Controller, ForbiddenException, Get, Headers, HttpException, HttpStatus, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
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
import { SyncRoute53CnameDto } from './dto/sync-route53-cname.dto';
import { SyncDcdnSslDto } from './dto/sync-dcdn-ssl.dto';
import { ApplyIngressManifestDto } from './dto/apply-ingress-manifest.dto';
import { AuthService } from '../auth/auth.service';
import { AccessControlService } from '../access-control/access-control.service';

@Controller('lines')
export class LinesController {
  constructor(
    private readonly linesService: LinesService,
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
  ) {}

  private async assertIngressProvisioningAccess(authorization?: string) {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer ')) {
      throw new ForbiddenException('Missing permissions: menu:line-onboarding or menu:admin-site-onboarding');
    }
    const identity = await this.authService.verifyToken(raw.slice(7).trim());
    const user = identity.source === 'keycloak' || typeof identity.sub !== 'number'
      ? await this.accessControl.ensureUserByUsername(identity.username, { displayName: identity.displayName })
      : { id: Number(identity.sub), username: identity.username };
    const me = await this.accessControl.getMe({ userId: Number(user.id) });
    if (!(me.permissions || []).some((permission: string) => ['menu:line-onboarding', 'menu:admin-site-onboarding'].includes(permission))) {
      throw new ForbiddenException('Missing permissions: menu:line-onboarding or menu:admin-site-onboarding');
    }
    return { userId: String(me.id), username: String(me.username || identity.username) };
  }

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
  applyDcdnSecurity(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Body() body: ApplyDcdnSecurityDto,
  ) {
    return this.linesService.applyDcdnSecurity(body, environmentId);
  }

  @Post('dcdn/ssl-sync/preview')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  previewDcdnSslSync(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Body() body: SyncDcdnSslDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.previewDcdnSslSyncFromK8sLineUrl(environmentId, body);
  }

  @Post('dcdn/ssl-sync')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  syncDcdnSsl(
    @Headers('x-target-environment') environmentId: string | undefined,
    @Body() body: SyncDcdnSslDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.syncDcdnSslFromK8sLineUrl(environmentId, body);
  }

  @Get('dcdn/cas-certificates')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listCasCertificates(@Query() query: ListCasCertificatesDto) {
    return this.linesService.listCasCertificates(query.rootDomain, query.targetDomain);
  }


  @Post('route53/cname/preview')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  previewRoute53Cname(
    @Headers('x-target-environment') environmentId: string,
    @Body() body: SyncRoute53CnameDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.previewRoute53Cname(environmentId, body);
  }

  @Post('route53/cname/sync')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  syncRoute53Cname(
    @Headers('x-target-environment') environmentId: string,
    @Body() body: SyncRoute53CnameDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    return this.linesService.syncRoute53Cname(environmentId, body);
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
  async applyTenantDomain(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: any,
    @Body() body: ApplyTenantDomainDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.environmentId && body.environmentId !== environmentId) {
      throw new HttpException('environmentId mismatch with X-Target-Environment', HttpStatus.BAD_REQUEST);
    }
    const actor = await this.assertIngressProvisioningAccess(authorization);
    await this.authService.verifyMfaForUser(Number(actor.userId), body.otpCode);
    return this.linesService.applyTenantDomain(environmentId, {
      tenantId: body.tenantId,
      domain: body.domain,
      requestId: req?.requestId,
      ...actor,
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

  @Post('ingress/clone-preview')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  cloneIngressPreview(
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
      tlsSecretMode: body.tlsSecretMode,
      tlsSecretName: body.tlsSecretName,
      confirmed: false,
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
      tlsSecretMode: body.tlsSecretMode,
      tlsSecretName: body.tlsSecretName,
      confirmed: body.confirmed,
      requestId: req?.requestId,
      userId: req?.user?.id ? String(req.user.id) : undefined,
      username: req?.user?.username,
    });
  }

  @Post('ingress/manifest/apply')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async applyIngressManifest(
    @Headers('x-target-environment') environmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() req: any,
    @Body() body: ApplyIngressManifestDto,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.environmentId !== environmentId) {
      throw new HttpException('environmentId mismatch with X-Target-Environment', HttpStatus.BAD_REQUEST);
    }
    const actor = await this.assertIngressProvisioningAccess(authorization);
    return this.linesService.applyIngressManifest(environmentId, {
      manifestYaml: body.manifestYaml,
      sourceIngressName: body.sourceIngressName,
      confirmed: body.confirmed,
      requestId: req?.requestId,
      ...actor,
    });
  }
}
