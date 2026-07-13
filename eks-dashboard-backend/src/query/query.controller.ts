import {
  Controller,
  Post,
  Body,
  ValidationPipe,
  Patch,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  Delete,
  Query,
  Get,
} from '@nestjs/common';
import { QueryService } from './query.service';
import { AggregateQueryDto } from './dto/query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  private checkEnvironmentHeader(environmentId: string) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('aggregate')
  async aggregateQuery(
    @Headers('x-target-environment') environmentId: string,
    @Headers('x-request-id') requestId: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-username') username: string | undefined,
    @Body(new ValidationPipe()) queryDto: AggregateQueryDto,
  ) {
    this.checkEnvironmentHeader(environmentId);
    return this.queryService.aggregate(
      environmentId,
      queryDto.identifier,
      queryDto.type,
      queryDto.tenantId,
      { requestId, userId, username },
    );
  }

  @Patch('users/:uid')
  async updateUser(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Body(new ValidationPipe({ transform: true }))
    body: UpdateUserDto & { tenantId: number },
  ) {
    this.checkEnvironmentHeader(environmentId);
    const { tenantId, ...updateUserDto } = body;
    return this.queryService.updateUser(
      environmentId,
      uid,
      tenantId,
      updateUserDto,
    );
  }

  @Post('users/:uid/deactivate')
  async deactivateUser(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Body() body: { tenantId: number },
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (body.tenantId === undefined) {
      throw new HttpException(
        'tenantId is required in the request body for deactivation.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.queryService.deactivateUser(environmentId, uid, body.tenantId);
  }

  @Post('redis-key')
  async createRedisKey(
    @Headers('x-target-environment') environmentId: string,
    @Body()
    body: {
      key?: string;
      value?: string;
      ttlSeconds?: number;
    },
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (!body.key) {
      throw new HttpException('Body field "key" is required.', HttpStatus.BAD_REQUEST);
    }
    if (body.value === undefined) {
      throw new HttpException('Body field "value" is required.', HttpStatus.BAD_REQUEST);
    }
    if (
      body.ttlSeconds !== undefined &&
      (!Number.isFinite(body.ttlSeconds) || body.ttlSeconds <= 0)
    ) {
      throw new HttpException(
        'Body field "ttlSeconds" must be a positive number when provided.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.queryService.createRedisKey(
      environmentId,
      body.key,
      body.value,
      body.ttlSeconds,
    );
  }

  @Delete('redis-key')
  async deleteRedisKey(
    @Headers('x-target-environment') environmentId: string,
    @Query('key') key: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (!key) {
      throw new HttpException(
        'Query parameter "key" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.queryService.deleteRedisKey(environmentId, key);
  }

  @Get('redis-key')
  async getRedisKey(
    @Headers('x-target-environment') environmentId: string,
    @Query('key') key: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (!key) {
      throw new HttpException(
        'Query parameter "key" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.queryService.getRedisKey(environmentId, key);
  }

  @Get('users/:uid/otc-merchant')
  async getOtcMerchantInfo(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Query('tenantId') tenantId?: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (!tenantId) {
      throw new HttpException(
        'Query parameter "tenantId" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tId = Number(tenantId);
    return this.queryService.getOtcMerchantInfoByUserUid(environmentId, uid, tId);
  }

  @Patch('users/:uid/otc-merchant/name')
  async updateOtcMerchantName(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Body() body: { name?: string; tenantId?: number },
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (body.name === undefined) {
      throw new HttpException('name is required in body', HttpStatus.BAD_REQUEST);
    }
    if (body.tenantId === undefined) {
      throw new HttpException('tenantId is required in body', HttpStatus.BAD_REQUEST);
    }
    return this.queryService.updateOtcMerchantNameByUserUid(
      environmentId,
      uid,
      body.name,
      body.tenantId,
    );
  }

  @Post('users/:uid/otc-user/disable')
  async disableOtcUserTrade(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    return this.queryService.disableOtcUserTrade(environmentId, uid);
  }

  @Post('users/:uid/otc-user/enable')
  async enableOtcUserTrade(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    return this.queryService.enableOtcUserTrade(environmentId, uid);
  }

  @Get('users/:uid/auth-record')
  async getAuthRecord(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (!tenantId) {
      throw new HttpException(
        'Query parameter "tenantId" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tId = Number(tenantId);
    const resolvedUserId =
      userId !== undefined && userId !== null && userId !== ''
        ? Number(userId)
        : undefined;
    return this.queryService.getAuthRecordByUserUid(
      environmentId,
      uid,
      tId,
      Number.isFinite(Number(resolvedUserId)) ? Number(resolvedUserId) : undefined,
    );
  }

  @Patch('users/:uid/auth-record')
  async updateAuthRecord(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Body() body: { realName?: string; cardNo?: string; tenantId?: number; userId?: number },
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (body.tenantId === undefined) {
      throw new HttpException('tenantId is required in body', HttpStatus.BAD_REQUEST);
    }
    if (body.userId === undefined || !Number.isFinite(Number(body.userId)) || Number(body.userId) <= 0) {
      throw new HttpException('userId is required in body', HttpStatus.BAD_REQUEST);
    }
    if (body.realName === undefined && body.cardNo === undefined) {
      throw new HttpException(
        'realName or cardNo is required in body',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.queryService.updateAuthRecordByUserUid(
      environmentId,
      uid,
      body.tenantId,
      body.realName,
      body.cardNo,
      Number(body.userId),
    );
  }

  @Get('users/:uid/trader')
  async getTraderInfo(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Query('tenantId') tenantId?: string,
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (!tenantId) {
      throw new HttpException(
        'Query parameter "tenantId" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tId = Number(tenantId);
    return this.queryService.getTraderInfoByUserUid(environmentId, uid, tId);
  }

  @Patch('users/:uid/trader')
  async updateTraderNick(
    @Headers('x-target-environment') environmentId: string,
    @Param('uid') uid: string,
    @Body() body: { nick_name?: string; tenantId?: number },
  ) {
    this.checkEnvironmentHeader(environmentId);
    if (body.nick_name === undefined) {
      throw new HttpException(
        'nick_name is required in body',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (body.tenantId === undefined) {
      throw new HttpException(
        'tenantId is required in body',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.queryService.updateTraderNickName(
      environmentId,
      uid,
      body.nick_name,
      body.tenantId,
    );
  }
}
