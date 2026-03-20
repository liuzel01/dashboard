import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { EnvironmentsService } from '../environments/environments.service';
import type { Environment } from '../environments/environment.types';
import request, { Request } from 'request';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';

const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';

interface K8sApis {
  kc: k8s.KubeConfig;
  k8sAppsV1Api: k8s.AppsV1Api;
  k8sCoreV1Api: k8s.CoreV1Api;
  k8sNetworkingV1Api: k8s.NetworkingV1Api;
  k8sLog: k8s.Log;
}

interface K8sCacheEntry {
  fingerprint: string;
  apis: K8sApis;
}

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);
  private k8sApiCache = new Map<string, K8sCacheEntry>();

  constructor(private readonly environmentsService: EnvironmentsService) {}

  private getEnvironmentFingerprint(env: Environment): string {
    return [
      env.kubeContext || '',
      env.aws_region || '',
      env.aws_profile || '',
      env.aws_access_key_id || '',
      env.aws_secret_access_key || '',
    ].join('|');
  }

  private async getK8sApis(environmentId: string): Promise<K8sApis> {
    const env = this.environmentsService.getEnvironmentById(environmentId);
    if (!env) {
      throw new Error(
        `Environment configuration for "${environmentId}" not found.`,
      );
    }
    const fingerprint = this.getEnvironmentFingerprint(env);
    const cached = this.k8sApiCache.get(environmentId);
    if (cached) {
      if (cached.fingerprint === fingerprint) {
        return cached.apis;
      }
      this.logger.log(
        `Environment "${environmentId}" config changed, recreating Kubernetes client.`,
      );
      this.k8sApiCache.delete(environmentId);
    }

    this.logger.log(
      `Creating new Kubernetes client for environment: ${environmentId}`,
    );

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
    const k8sNetworkingV1Api = kc.makeApiClient(k8s.NetworkingV1Api);
    const k8sLog = new k8s.Log(kc);

    const apis = { kc, k8sAppsV1Api, k8sCoreV1Api, k8sNetworkingV1Api, k8sLog };
    this.k8sApiCache.set(environmentId, { fingerprint, apis });

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

  async listIngressOriginCandidates(environmentId: string, keyword = 'nginx-web-app') {
    const { k8sNetworkingV1Api } = await this.getK8sApis(environmentId);
    const { body } = await k8sNetworkingV1Api.listIngressForAllNamespaces();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const items = Array.isArray(body?.items) ? body.items : [];

    const mapped = items
      .filter((item) => {
        if (!normalizedKeyword) return true;
        const namespace = String(item?.metadata?.namespace || '').toLowerCase();
        const name = String(item?.metadata?.name || '').toLowerCase();
        return namespace.includes(normalizedKeyword) || name.includes(normalizedKeyword);
      })
      .map((item) => {
        const namespace = String(item?.metadata?.namespace || 'default');
        const name = String(item?.metadata?.name || '');
        const ruleHosts = (item?.spec?.rules || [])
          .map((rule) => String(rule?.host || '').trim())
          .filter(Boolean);
        const lbAddresses = (item?.status?.loadBalancer?.ingress || [])
          .map((ing) => String(ing?.hostname || ing?.ip || '').trim())
          .filter(Boolean);
        const originCandidates = Array.from(new Set([...lbAddresses, ...ruleHosts]));
        return {
          namespace,
          name,
          createdAt: item?.metadata?.creationTimestamp || null,
          ruleHosts,
          lbAddresses,
          originCandidates,
        };
      })
      .filter((item) => item.originCandidates.length > 0);

    return {
      environmentId,
      keyword: normalizedKeyword || null,
      total: mapped.length,
      items: mapped,
      fetchedAt: new Date().toISOString(),
    };
  }

  async requestServiceProxy(
    environmentId: string,
    input: {
      namespace: string;
      serviceName: string;
      port: number;
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      query?: Record<string, any>;
      body?: any;
      timeoutMs?: number;
    },
  ): Promise<{ statusCode: number; body: any; headers: Record<string, any> }> {
    const { kc } = await this.getK8sApis(environmentId);
    const contextName = kc.getCurrentContext();
    const cluster = kc.getCurrentCluster();
    if (!cluster?.server) {
      throw new Error(`Kubernetes cluster server is missing for environment "${environmentId}"`);
    }

    const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
    const serviceRef = `${input.serviceName}:${input.port}`;
    const uri = `${cluster.server}/api/v1/namespaces/${encodeURIComponent(
      input.namespace,
    )}/services/${encodeURIComponent(serviceRef)}/proxy${normalizedPath}`;

    const options: request.Options = {
      method: input.method || 'GET',
      uri,
      qs: input.query,
      body: input.body,
      json: true,
      timeout: input.timeoutMs ?? 15000,
      headers: {
        Accept: 'application/json',
      },
    };
    if (input.body !== undefined) {
      (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    this.logger.log(
      `[ServiceProxy] env=${environmentId} context=${contextName} method=${options.method} target=${input.namespace}/${input.serviceName}:${input.port}${normalizedPath} query=${JSON.stringify(
        input.query || {},
      )}`,
    );

    await kc.applyToRequest(options);

    return await new Promise((resolve, reject) => {
      request(options, (error, response, body) => {
        if (error) {
          this.logger.error(
            `[ServiceProxy] request error env=${environmentId} context=${contextName}: ${String(
              (error as any)?.message || error,
            )}`,
          );
          reject(error);
          return;
        }
        const statusCode = response?.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          if (statusCode === 401) {
            this.requestServiceViaKubectlProxy(environmentId, input)
              .then((fallback) => resolve(fallback))
              .catch((fallbackError) => {
                const bodyPreview =
                  typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240);
                this.logger.warn(
                  `[ServiceProxy] fallback failed env=${environmentId} context=${contextName} status=${statusCode} body=${bodyPreview} fallback=${String(
                    (fallbackError as any)?.message || fallbackError,
                  )}`,
                );
                reject(
                  new Error(
                    `Service proxy request failed (${statusCode}): ${typeof body === 'string' ? body : JSON.stringify(body)}`,
                  ),
                );
              });
            return;
          }
          const bodyPreview =
            typeof body === 'string' ? body.slice(0, 240) : JSON.stringify(body).slice(0, 240);
          this.logger.warn(
            `[ServiceProxy] non-2xx env=${environmentId} context=${contextName} status=${statusCode} body=${bodyPreview}`,
          );
          reject(
            new Error(
              `Service proxy request failed (${statusCode}): ${typeof body === 'string' ? body : JSON.stringify(body)}`,
            ),
          );
          return;
        }
        this.logger.log(
          `[ServiceProxy] success env=${environmentId} context=${contextName} status=${statusCode}`,
        );
        resolve({
          statusCode,
          body,
          headers: (response?.headers || {}) as Record<string, any>,
        });
      });
    });
  }

  private async requestServiceViaKubectlProxy(
    environmentId: string,
    input: {
      namespace: string;
      serviceName: string;
      port: number;
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      query?: Record<string, any>;
      body?: any;
      timeoutMs?: number;
    },
  ): Promise<{ statusCode: number; body: any; headers: Record<string, any> }> {
    const env = this.environmentsService.getEnvironmentById(environmentId);
    if (!env?.kubeContext) {
      throw new Error(`Environment "${environmentId}" kubeContext is missing`);
    }

    const proxy = spawn('kubectl', ['--context', env.kubeContext, 'proxy', '--port=0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const waitForPort = () =>
      new Promise<number>((resolve, reject) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          reject(new Error('kubectl proxy start timeout'));
        }, 10000);

        const onData = (chunk: Buffer) => {
          const text = chunk.toString();
          const matched = text.match(/Starting to serve on 127\.0\.0\.1:(\d+)/);
          if (!matched || resolved) return;
          resolved = true;
          clearTimeout(timeout);
          resolve(Number(matched[1]));
        };

        proxy.stdout.on('data', onData);
        proxy.stderr.on('data', onData);
        proxy.on('exit', (code) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`kubectl proxy exited early with code ${code ?? 'null'}`));
        });
      });

    try {
      const localPort = await waitForPort();
      const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
      const serviceRef = `${input.serviceName}:${input.port}`;
      const uri = `http://127.0.0.1:${localPort}/api/v1/namespaces/${encodeURIComponent(
        input.namespace,
      )}/services/${encodeURIComponent(serviceRef)}/proxy${normalizedPath}`;
      const options: request.Options = {
        method: input.method || 'GET',
        uri,
        qs: input.query,
        body: input.body,
        json: true,
        timeout: input.timeoutMs ?? 15000,
        headers: {
          Accept: 'application/json',
        },
      };
      if (input.body !== undefined) {
        (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }

      this.logger.log(
        `[ServiceProxyFallback] env=${environmentId} context=${env.kubeContext} method=${options.method} target=${input.namespace}/${input.serviceName}:${input.port}${normalizedPath}`,
      );

      return await new Promise((resolve, reject) => {
        request(options, (error, response, body) => {
          if (error) {
            reject(error);
            return;
          }
          const statusCode = response?.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Service proxy fallback request failed (${statusCode}): ${typeof body === 'string' ? body : JSON.stringify(body)}`,
              ),
            );
            return;
          }
          resolve({
            statusCode,
            body,
            headers: (response?.headers || {}) as Record<string, any>,
          });
        });
      });
    } finally {
      if (!proxy.killed) {
        proxy.kill('SIGTERM');
      }
    }
  }
}
