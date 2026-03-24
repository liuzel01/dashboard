import {
  Controller,
  Get,
  Post,
  Param,
  Logger,
  HttpException,
  HttpStatus,
  Query,
  Headers,
} from '@nestjs/common';
import { KubernetesService } from '../kubernetes/kubernetes.service';

@Controller('deployments')
export class DeploymentsController {
  private readonly logger = new Logger(DeploymentsController.name);

  constructor(private readonly k8sService: KubernetesService) {}

  @Get()
  async getDeployments(
    @Headers('x-target-environment') environmentId: string,
    @Query('name') name?: string,
  ) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      this.logger.log(
        `Fetching all deployments from the "default" namespace for env "${environmentId}"...`,
      );
      const deployments = await this.k8sService.getDeployments(
        environmentId,
        'default',
      );
      this.logger.log(`Found ${deployments.length} total deployments.`);

      let filteredDeployments = deployments;
      if (name && name.trim() !== '') {
        const filterName = name.toLowerCase();
        this.logger.log(
          `Filtering deployments with name containing: "${filterName}"`,
        );
        // 支持模糊、不区分大小写的筛选
        filteredDeployments = deployments.filter((d) =>
          (d.metadata?.name || '').toLowerCase().includes(filterName),
        );
      }

      this.logger.log(
        `Returning ${filteredDeployments.length} filtered deployments.`,
      );

      return filteredDeployments.map((d) => ({
        name: d.metadata?.name,
        namespace: d.metadata?.namespace,
        replicas: d.spec?.replicas,
        availableReplicas: d.status?.availableReplicas || 0,
        readyReplicas: d.status?.readyReplicas || 0,
        updatedReplicas: d.status?.updatedReplicas || 0,
        unavailableReplicas: d.status?.unavailableReplicas || 0,
        generation: d.metadata?.generation || 0,
        observedGeneration: d.status?.observedGeneration || 0,
        progressingStatus:
          d.status?.conditions?.find((c) => c.type === 'Progressing')?.status ||
          null,
        progressingReason:
          d.status?.conditions?.find((c) => c.type === 'Progressing')?.reason ||
          null,
        availableStatus:
          d.status?.conditions?.find((c) => c.type === 'Available')?.status ||
          null,
        availableReason:
          d.status?.conditions?.find((c) => c.type === 'Available')?.reason ||
          null,
        lastRestartAt:
          d.spec?.template?.metadata?.annotations?.[
            'kubectl.kubernetes.io/restartedAt'
          ] || null,
        creationTimestamp: d.metadata?.creationTimestamp,
        images:
          d.spec?.template?.spec?.containers?.map((c) => c.image).join(', ') ??
          '',
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get deployments for env "${environmentId}"`,
        error.body || error,
      );
      throw new HttpException(
        'Failed to fetch deployments from Kubernetes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':name/restart')
  async restartDeployment(
    @Param('name') name: string,
    @Headers('x-target-environment') environmentId: string,
  ) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      this.logger.log(
        `Restarting deployment: ${name} in env "${environmentId}"`,
      );
      return await this.k8sService.restartDeployment(
        environmentId,
        name,
        'default',
      );
    } catch (error) {
      this.logger.error(
        `Failed to restart deployment ${name} in env "${environmentId}"`,
        error.body || error,
      );
      throw new HttpException(
        'Failed to restart deployment',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
