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
    @Body(new ValidationPipe()) queryDto: AggregateQueryDto,
  ) {
    this.checkEnvironmentHeader(environmentId);
    return this.queryService.aggregate(
      environmentId,
      queryDto.identifier,
      queryDto.type,
      queryDto.tenantId,
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
}
