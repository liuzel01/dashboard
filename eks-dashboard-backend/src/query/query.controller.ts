import {
  Controller,
  Post,
  Body,
  ValidationPipe,
  Patch,
  Param,
} from '@nestjs/common';
import { QueryService } from './query.service';
import { AggregateQueryDto } from './dto/query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post('aggregate')
  async aggregateQuery(
    @Body(new ValidationPipe()) queryDto: AggregateQueryDto,
  ) {
    return this.queryService.aggregate(queryDto.identifier, queryDto.type);
  }

  @Patch('users/:uid')
  async updateUser(
    @Param('uid') uid: string,
    @Body(new ValidationPipe({ transform: true })) updateUserDto: UpdateUserDto,
  ) {
    return this.queryService.updateUser(uid, updateUserDto);
  }

  @Post('users/:uid/deactivate')
  async deactivateUser(@Param('uid') uid: string) {
    return this.queryService.deactivateUser(uid);
  }
}
