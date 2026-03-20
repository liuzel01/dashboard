import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LinesController } from './lines.controller';
import { LinesService } from './lines.service';
import { KubernetesModule } from '../kubernetes/kubernetes.module';

@Module({
  imports: [HttpModule, KubernetesModule],
  controllers: [LinesController],
  providers: [LinesService],
})
export class LinesModule {}
