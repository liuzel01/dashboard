import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService, MongoDataService } from './query.service';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { EnvironmentsModule } from '../environments/environments.module';
import { QueryGatewayClientService } from './query-gateway-client.service';
import { SiteConfModule } from '../site-conf/site-conf.module';

@Module({
  imports: [KubernetesModule, EnvironmentsModule, SiteConfModule],
  controllers: [QueryController],
  // RedisDataService has been replaced by the real RedisService from RedisModule
  providers: [QueryService, MongoDataService, QueryGatewayClientService],
})
export class QueryModule {}
