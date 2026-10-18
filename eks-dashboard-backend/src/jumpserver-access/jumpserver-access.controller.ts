import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JumpserverAccessService } from './jumpserver-access.service';

class MappingDto {
  @IsInt() @Min(1) dashboardUserId!: number;
  @IsString() @MaxLength(128) remoteUsername!: string;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: string;
}
class BundleDto {
  @IsString() @MaxLength(128) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsArray() targets!: Array<{
    type: 'ASSET' | 'NODE';
    id: string;
    name: string;
  }>;
  @IsArray() accounts!: string[];
  @IsArray() protocols!: string[];
}
class UserBindDto {
  @IsInt() @Min(1) dashboardUserId!: number;
}
class TicketDto {
  @IsString() ticket!: string;
}

@Controller('jumpserver-access')
export class JumpserverAccessController {
  constructor(private readonly service: JumpserverAccessService) {}
  @Get('diagnostics') diagnostics(@Headers('authorization') a?: string) {
    return this.service.diagnostics(a);
  }
  @Get('catalog') catalog(
    @Headers('authorization') a: string | undefined,
    @Query('kind') kind: string,
    @Query('keyword') keyword = '',
  ) {
    return this.service.catalog(a, kind, keyword);
  }
  @Get('configuration') configuration(@Headers('authorization') a?: string) {
    return this.service.configuration(a);
  }
  @Post('mappings') mapping(
    @Headers('authorization') a: string | undefined,
    @Body() body: MappingDto,
  ) {
    return this.service.upsertMapping(a, body);
  }
  @Post('bundles') bundle(
    @Headers('authorization') a: string | undefined,
    @Body() body: BundleDto,
  ) {
    return this.service.createBundle(a, body);
  }
  @Post('bundles/:id/users') bindUser(
    @Headers('authorization') a: string | undefined,
    @Param('id') id: string,
    @Body() body: UserBindDto,
  ) {
    return this.service.bindUser(a, Number(id), body.dashboardUserId);
  }
  @Delete('bundles/:id/users/:userId') unbindUser(
    @Headers('authorization') a: string | undefined,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.service.unbindUser(a, Number(id), Number(userId));
  }
  @Post('users/:id/sync') sync(
    @Headers('authorization') a: string | undefined,
    @Param('id') id: string,
  ) {
    return this.service.syncUser(a, Number(id));
  }
  @Get('me') me(@Headers('authorization') a?: string) {
    return this.service.myStatus(a);
  }
  @Post('portal/prepare') prepare(
    @Headers('authorization') a: string | undefined,
    @Headers('x-dashboard-session') s = '',
  ) {
    return this.service.prepareTicket(a, s);
  }
  @Post('portal/consume') consume(
    @Headers('authorization') a: string | undefined,
    @Headers('x-dashboard-session') s = '',
    @Body() body: TicketDto,
  ) {
    return this.service.consumeTicket(a, s, body.ticket);
  }
}
