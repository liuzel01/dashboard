import { Module } from '@nestjs/common';
import { LogsGateway } from './logs.gateway';
import { KubernetesModule } from '../kubernetes/kubernetes.module';

@Module({
  // Explicitly import the KubernetesModule to declare the dependency.
  imports: [KubernetesModule],
  providers: [LogsGateway],
  exports: [LogsGateway],
})
export class LogsModule {}
