import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { EnvironmentsService } from '../environments/environments.service';
import { Request } from 'request';
import { PassThrough } from 'node:stream';

const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';

interface K8sApis {
  k8sAppsV1Api: k8s.AppsV1Api;
  k8sCoreV1Api: k8s.CoreV1Api;
  k8sLog: k8s.Log;
}

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);
  private k8sApiCache = new Map<string, K8sApis>();

  constructor(private readonly environmentsService: EnvironmentsService) {}

  private async getK8sApis(environmentId: string): Promise<K8sApis> {
    if (this.k8sApiCache.has(environmentId)) {
      return this.k8sApiCache.get(environmentId)!;
    }

    this.logger.log(
      `Creating new Kubernetes client for environment: ${environmentId}`,
    );

    const env = this.environmentsService.getEnvironmentById(environmentId);

    if (!env) {
      throw new Error(
        `Environment configuration for "${environmentId}" not found.`,
      );
    }

    if (!env.kubeContext) {
      throw new Error(
        `"kubeContext" is not defined for environment "${environmentId}" in environments.json.`,
      );
    }

    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();

    const contextExists = kc.contexts.some((c) => c.name === env.kubeContext);
    if (!contextExists) {
      throw new Error(
        `Kubeconfig context "${env.kubeContext}" not found in your kubeconfig file.`,
      );
    }
    kc.setCurrentContext(env.kubeContext);

    const user = kc.getCurrentUser();

    if (user?.exec?.command === 'aws') {
      this.logger.debug(
        `Configuring AWS credentials for Kubeconfig exec provider for env "${environmentId}".`,
      );

      // Initialize with region, which is always needed.
      const awsEnv: { name: string; value: string }[] = [
        { name: 'AWS_REGION', value: env.aws_region },
      ];

      if (env.aws_access_key_id && env.aws_secret_access_key) {
        this.logger.debug(`Using AWS access key for Kubeconfig.`);
        awsEnv.push(
          { name: 'AWS_ACCESS_KEY_ID', value: env.aws_access_key_id },
          { name: 'AWS_SECRET_ACCESS_KEY', value: env.aws_secret_access_key },
        );
      } else if (env.aws_profile) {
        this.logger.debug(
          `Using AWS profile "${env.aws_profile}" for Kubeconfig.`,
        );
        awsEnv.push({ name: 'AWS_PROFILE', value: env.aws_profile });
      } else {
        this.logger.debug(
          `Using default AWS credential provider chain for Kubeconfig.`,
        );
      }
      user.exec.env = awsEnv;
    }

    const k8sAppsV1Api = kc.makeApiClient(k8s.AppsV1Api);
    const k8sCoreV1Api = kc.makeApiClient(k8s.CoreV1Api);
    const k8sLog = new k8s.Log(kc);

    const apis = { k8sAppsV1Api, k8sCoreV1Api, k8sLog };
    this.k8sApiCache.set(environmentId, apis);

    this.logger.log(
      `Successfully created Kubernetes client for environment: ${environmentId}`,
    );
    return apis;
  }

  async getDeployments(environmentId: string, namespace = 'default') {
    const { k8sAppsV1Api } = await this.getK8sApis(environmentId);
    const { body } = await k8sAppsV1Api.listNamespacedDeployment(namespace);
    return body.items;
  }

  async restartDeployment(
    environmentId: string,
    name: string,
    namespace = 'default',
  ) {
    const { k8sAppsV1Api } = await this.getK8sApis(environmentId);
    try {
      this.logger.log(
        `Restarting deployment "${name}" in namespace "${namespace}" by updating annotations.`,
      );
      const { body: deployment } = await k8sAppsV1Api.readNamespacedDeployment(
        name,
        namespace,
      );

      if (!deployment.spec?.template) {
        throw new Error(
          `Deployment "${name}" is invalid: missing spec.template.`,
        );
      }

      deployment.spec.template.metadata =
        deployment.spec.template.metadata ?? {};
      deployment.spec.template.metadata.annotations =
        deployment.spec.template.metadata.annotations ?? {};

      deployment.spec.template.metadata.annotations[RESTART_ANNOTATION] =
        new Date().toISOString();

      await k8sAppsV1Api.replaceNamespacedDeployment(
        name,
        namespace,
        deployment,
      );
      this.logger.log(
        `Deployment ${name} in namespace ${namespace} restarted.`,
      );
      return { message: `Deployment ${name} restarted successfully.` };
    } catch (e) {
      const errorDetails = e.response ? e.response.body : e.body || e;
      this.logger.error(`Error restarting deployment ${name}:`, errorDetails);
      throw e;
    }
  }

  async getPodsForDeployment(
    environmentId: string,
    deploymentName: string,
    namespace = 'default',
  ) {
    const { k8sAppsV1Api, k8sCoreV1Api } = await this.getK8sApis(environmentId);
    const { body: deployment } = await k8sAppsV1Api.readNamespacedDeployment(
      deploymentName,
      namespace,
    );
    const matchLabels = deployment.spec?.selector?.matchLabels;

    if (!matchLabels) {
      throw new Error(`No selector found for deployment ${deploymentName}`);
    }

    const labelSelector = Object.entries(matchLabels)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');

    const { body: podList } = await k8sCoreV1Api.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector,
    );

    return podList.items;
  }

  async streamPodLogs(
    environmentId: string,
    podName: string,
    containerName: string,
    namespace: string,
    logStream: PassThrough,
    callback: (err: any) => void,
    options: {
      follow: boolean;
      tailLines: number;
      pretty: boolean;
      timestamps: boolean;
    },
  ): Promise<Request> {
    const { k8sLog } = await this.getK8sApis(environmentId);
    return k8sLog.log(
      namespace,
      podName,
      containerName,
      logStream,
      callback,
      options,
    );
  }
}
