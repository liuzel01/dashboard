import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { EnvironmentsModule } from '../environments/environments.module';

@Module({
  // Explicitly import the KubernetesModule to declare the dependency.
  imports: [KubernetesModule, EnvironmentsModule],
  controllers: [DeploymentsController],
})
export class DeploymentsModule {}
