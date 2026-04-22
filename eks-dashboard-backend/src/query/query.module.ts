import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService, MongoDataService } from './query.service';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { QueryGatewayClientService } from './query-gateway-client.service';

@Module({
  imports: [DatabaseModule, RedisModule, KubernetesModule, EnvironmentsModule],
  controllers: [QueryController],
  // RedisDataService has been replaced by the real RedisService from RedisModule
  providers: [QueryService, MongoDataService, QueryGatewayClientService],
})
export class QueryModule {}
