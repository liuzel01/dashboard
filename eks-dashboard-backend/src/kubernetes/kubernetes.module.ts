import { Module } from '@nestjs/common';
import { KubernetesService } from './kubernetes.service';
import { EnvironmentsModule } from '../environments/environments.module';

@Module({
  imports: [EnvironmentsModule],
  providers: [KubernetesService],
  exports: [KubernetesService],
})
export class KubernetesModule {}
