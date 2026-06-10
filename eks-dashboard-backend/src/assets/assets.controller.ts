import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import {
  CreateAssetAccountDto,
  CreateAssetDomainDto,
  CreateAssetResourceDto,
  CreateCredentialRefDto,
  ListAssetsDto,
  ListChangeLogsDto,
  UpdateAssetAccountDto,
  UpdateAssetDomainDto,
  UpdateAssetResourceDto,
  UpdateCredentialRefDto,
} from './dto/asset.dto';

const validation = new ValidationPipe({ transform: true, whitelist: true });

@Controller('assets')
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get('overview')
  async overview(@Headers('authorization') authorization?: string) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.getOverview(actor);
  }

  @Get('cdn/wangsu/domains/preview')
  async previewWangsuDomains(@Headers('authorization') authorization?: string) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.previewWangsuDomains(actor);
  }

  @Get('accounts')
  async listAccounts(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListAssetsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listAccounts(actor, query);
  }

  @Post('accounts')
  async createAccount(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: CreateAssetAccountDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createAccount(actor, body);
  }

  @Patch('accounts/:id')
  async updateAccount(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(validation) body: UpdateAssetAccountDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateAccount(actor, id, body);
  }

  @Delete('accounts/:id')
  async deleteAccount(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.deleteAccount(actor, id);
  }

  @Post('accounts/:id/restore')
  async restoreAccount(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.restoreAccount(actor, id);
  }

  @Get('resources')
  async listResources(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListAssetsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listResources(actor, query);
  }

  @Post('resources')
  async createResource(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: CreateAssetResourceDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createResource(actor, body);
  }

  @Patch('resources/:id')
  async updateResource(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(validation) body: UpdateAssetResourceDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateResource(actor, id, body);
  }

  @Delete('resources/:id')
  async deleteResource(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.deleteResource(actor, id);
  }

  @Post('resources/:id/restore')
  async restoreResource(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.restoreResource(actor, id);
  }

  @Get('domains')
  async listDomains(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListAssetsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listDomains(actor, query);
  }

  @Post('domains')
  async createDomain(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: CreateAssetDomainDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createDomain(actor, body);
  }

  @Patch('domains/:id')
  async updateDomain(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(validation) body: UpdateAssetDomainDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateDomain(actor, id, body);
  }

  @Delete('domains/:id')
  async deleteDomain(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.deleteDomain(actor, id);
  }

  @Post('domains/:id/restore')
  async restoreDomain(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.restoreDomain(actor, id);
  }

  @Get('credential-refs')
  async listCredentialRefs(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListAssetsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listCredentialRefs(actor, query);
  }

  @Post('credential-refs')
  async createCredentialRef(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: CreateCredentialRefDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.createCredentialRef(actor, body);
  }

  @Patch('credential-refs/:id')
  async updateCredentialRef(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body(validation) body: UpdateCredentialRefDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.updateCredentialRef(actor, id, body);
  }

  @Delete('credential-refs/:id')
  async deleteCredentialRef(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.deleteCredentialRef(actor, id);
  }

  @Post('credential-refs/:id/restore')
  async restoreCredentialRef(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.restoreCredentialRef(actor, id);
  }

  @Get('change-logs')
  async listChangeLogs(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) query: ListChangeLogsDto,
  ) {
    const actor = await this.service.resolveActorFromAuthorization(authorization);
    return this.service.listChangeLogs(actor, query);
  }
}
