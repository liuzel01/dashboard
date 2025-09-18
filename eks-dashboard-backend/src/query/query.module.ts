import { Module } from '@nestjs/common';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

// 模拟服务，实际项目中应导入对应的真实模块。DatabaseModule 已设为全局，无需在此导入。
import { RedisDataService, MongoDataService } from './query.service';

@Module({
  controllers: [QueryController],
  // DatabaseService 由全局的 DatabaseModule 提供
  // MysqlDataService 已被替换
  providers: [QueryService, RedisDataService, MongoDataService],
})
export class QueryModule {}
