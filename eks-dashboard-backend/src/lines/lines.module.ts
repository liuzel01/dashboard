import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';

@Module({
  imports: [HttpModule],
  controllers: [LinesController],
  providers: [LinesService],
})
export class LinesModule {}
