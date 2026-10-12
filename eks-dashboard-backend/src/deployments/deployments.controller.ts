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
  Body,
} from '@nestjs/common';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { listWorkloadTypes, resolveWorkloadType, WORKLOAD_TYPE_DEFINITIONS } from '../kubernetes/workload-types';

@Controller('deployments')
export class DeploymentsController {
  private readonly logger = new Logger(DeploymentsController.name);

  constructor(private readonly k8sService: KubernetesService) {}

  private normalizeNamespace(namespace?: string): string {
    const normalized = (namespace || 'default').trim();
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(normalized) || normalized.length > 63) {
      throw new HttpException(
        'Query parameter "namespace" must be a valid Kubernetes namespace.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return normalized;
  }

  @Get('namespaces')
  async getNamespaces(@Headers('x-target-environment') environmentId: string) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.k8sService.listNamespaces(environmentId);
    } catch (error) {
      this.logger.error(
        `Failed to list namespaces for env "${environmentId}"`,
        error.body || error,
      );
      throw new HttpException(
        'Failed to fetch namespaces from Kubernetes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('types')
  getWorkloadTypes() {
    return listWorkloadTypes();
  }

  @Get()
  async getDeployments(
    @Headers('x-target-environment') environmentId: string,
    @Query('name') name?: string,
    @Query('namespace') namespace?: string,
    @Query('type') type?: string,
  ) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const targetNamespace = this.normalizeNamespace(namespace);
    let workloadType: ReturnType<typeof resolveWorkloadType>;
    try {
      workloadType = resolveWorkloadType(type);
    } catch (error) {
      throw new HttpException((error as Error).message, HttpStatus.BAD_REQUEST);
    }
    try {
      this.logger.log(
        `Fetching ${workloadType} workloads from the "${targetNamespace}" namespace for env "${environmentId}"...`,
      );
      const workloads = await this.k8sService.getWorkloads(
        environmentId,
        workloadType,
        targetNamespace,
      );
      this.logger.log(`Found ${workloads.length} total ${workloadType} workloads.`);

      let filteredWorkloads = workloads;
      if (name && name.trim() !== '') {
        const filterName = name.toLowerCase();
        this.logger.log(
          `Filtering ${workloadType} workloads with name containing: "${filterName}"`,
        );
        // 支持模糊、不区分大小写的筛选
        filteredWorkloads = workloads.filter((d) =>
          (d.metadata?.name || '').toLowerCase().includes(filterName),
        );
      }

      this.logger.log(
        `Returning ${filteredWorkloads.length} filtered ${workloadType} workloads.`,
      );

      const definition = WORKLOAD_TYPE_DEFINITIONS[workloadType];
      return filteredWorkloads.map((d: any) => {
        const updateStrategyType = workloadType === 'deployment'
          ? 'RollingUpdate'
          : d.spec?.updateStrategy?.type || 'RollingUpdate';
        const partition = workloadType === 'statefulset'
          ? Number(d.spec?.updateStrategy?.rollingUpdate?.partition || 0)
          : 0;
        const restartReason = updateStrategyType !== 'RollingUpdate'
          ? `${definition.kind} 使用 ${updateStrategyType} 策略，无法自动滚动重启。`
          : partition > 0
            ? `StatefulSet 配置了 partition=${partition}，自动重启只会覆盖部分副本。`
            : undefined;
        const isDaemonSet = workloadType === 'daemonset';
        const desiredReplicas = isDaemonSet
          ? Number(d.status?.desiredNumberScheduled || 0)
          : Number(d.spec?.replicas || 0);
        const readyReplicas = Number(
          isDaemonSet ? d.status?.numberReady : d.status?.readyReplicas || 0,
        );
        const updatedReplicas = Number(
          isDaemonSet
            ? d.status?.updatedNumberScheduled
            : d.status?.updatedReplicas || 0,
        );
        const availableReplicas = Number(
          isDaemonSet
            ? d.status?.numberAvailable
            : d.status?.availableReplicas || readyReplicas,
        );
        const unavailableReplicas = Number(
          isDaemonSet
            ? d.status?.numberUnavailable
            : d.status?.unavailableReplicas || 0,
        );
        const isAvailable =
          desiredReplicas === 0 ||
          (readyReplicas >= desiredReplicas &&
            updatedReplicas >= desiredReplicas &&
            unavailableReplicas === 0);
        return {
          workloadType,
          workloadKind: definition.kind,
          capabilities: {
            ...definition.capabilities,
            restart: definition.capabilities.restart && !restartReason,
            restartReason,
          },
          name: d.metadata?.name,
          namespace: d.metadata?.namespace,
          replicas: desiredReplicas,
          availableReplicas,
          readyReplicas,
          updatedReplicas,
          unavailableReplicas,
          generation: d.metadata?.generation || 0,
          observedGeneration: d.status?.observedGeneration || 0,
          progressingStatus:
            workloadType === 'deployment'
              ? d.status?.conditions?.find((c: any) => c.type === 'Progressing')
                  ?.status || null
              : null,
          progressingReason:
            workloadType === 'deployment'
              ? d.status?.conditions?.find((c: any) => c.type === 'Progressing')
                  ?.reason || null
              : null,
          availableStatus:
            workloadType === 'deployment'
              ? d.status?.conditions?.find((c: any) => c.type === 'Available')
                  ?.status || null
              : isAvailable
                ? 'True'
                : 'False',
          availableReason:
            workloadType === 'deployment'
              ? d.status?.conditions?.find((c: any) => c.type === 'Available')
                  ?.reason || null
              : isAvailable
                ? null
                : 'NotReady',
          lastRestartAt:
            d.spec?.template?.metadata?.annotations?.[
              'kubectl.kubernetes.io/restartedAt'
            ] || null,
          creationTimestamp: d.metadata?.creationTimestamp,
          images:
            d.spec?.template?.spec?.containers
              ?.map((c: any) => c.image)
              .join(', ') ?? '',
        };
      });
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
    @Query('namespace') namespace?: string,
    @Query('type') type?: string,
  ) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const targetNamespace = this.normalizeNamespace(namespace);
    let workloadType: ReturnType<typeof resolveWorkloadType>;
    try {
      workloadType = resolveWorkloadType(type);
    } catch (error) {
      throw new HttpException((error as Error).message, HttpStatus.BAD_REQUEST);
    }
    try {
      this.logger.log(
        `Restarting ${workloadType}: ${name} in env "${environmentId}"`,
      );
      return await this.k8sService.restartWorkload(
        environmentId,
        name,
        workloadType,
        targetNamespace,
      );
    } catch (error) {
      this.logger.error(
        `Failed to restart deployment ${name} in env "${environmentId}"`,
        error.body || error,
      );
      throw new HttpException(
        (error as Error).message || 'Failed to restart workload',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  @Get(':name/image-history')
  async getDeploymentImageHistory(
    @Param('name') name: string,
    @Headers('x-target-environment') environmentId: string,
    @Query('namespace') namespace?: string,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const targetNamespace = this.normalizeNamespace(namespace);
    try {
      return await this.k8sService.getDeploymentImageHistory(environmentId, name, targetNamespace);
    } catch (error) {
      this.logger.error(`Failed to get image history for ${name} in env "${environmentId}"`, error.body || error);
      throw new HttpException('Failed to fetch deployment image history', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':name/rollback-images')
  async rollbackDeploymentImages(
    @Param('name') name: string,
    @Body() body: { images?: Array<{ name?: string; image?: string }> },
    @Headers('x-target-environment') environmentId: string,
    @Query('namespace') namespace?: string,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const targetNamespace = this.normalizeNamespace(namespace);
    try {
      const images = body?.images?.map((item) => ({ name: String(item.name || ''), image: String(item.image || '') })) || [];
      return await this.k8sService.rollbackDeploymentImages(environmentId, name, images, targetNamespace);
    } catch (error) {
      this.logger.error(`Failed to roll back images for ${name} in env "${environmentId}"`, error.body || error);
      throw new HttpException(error?.message || 'Failed to roll back deployment images', HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':name/rollout-status')
  async getDeploymentRolloutStatus(
    @Param('name') name: string,
    @Headers('x-target-environment') environmentId: string,
    @Query('generation') generation?: string,
    @Query('namespace') namespace?: string,
    @Query('type') type?: string,
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const targetGeneration = generation === undefined ? undefined : Number(generation);
    if (targetGeneration !== undefined && (!Number.isInteger(targetGeneration) || targetGeneration < 1)) {
      throw new HttpException('Query parameter "generation" must be a positive integer.', HttpStatus.BAD_REQUEST);
    }
    const targetNamespace = this.normalizeNamespace(namespace);
    let workloadType: ReturnType<typeof resolveWorkloadType>;
    try {
      workloadType = resolveWorkloadType(type);
    } catch (error) {
      throw new HttpException((error as Error).message, HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.k8sService.getWorkloadRolloutStatus(
        environmentId,
        name,
        workloadType,
        targetGeneration,
        targetNamespace,
      );
    } catch (error) {
      this.logger.error(
        `Failed to get rollout status for deployment ${name} in env "${environmentId}"`,
        error.body || error,
      );
      throw new HttpException(
        'Failed to fetch deployment rollout status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
