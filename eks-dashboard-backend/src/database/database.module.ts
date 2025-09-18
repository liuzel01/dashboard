import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Global() // 将模块设为全局，这样其他模块无需导入即可使用 DatabaseService
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
