import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService, MongoDataService } from './query.service';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [QueryController],
  // RedisDataService has been replaced by the real RedisService from RedisModule
  providers: [QueryService, MongoDataService],
})
export class QueryModule {}
