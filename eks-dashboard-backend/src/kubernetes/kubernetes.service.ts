import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { EnvironmentsService } from '../environments/environments.service';
import type { Environment } from '../environments/environment.types';
import request, { Request } from 'request';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';

const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';
const DEPLOYMENT_REVISION_ANNOTATION = 'deployment.kubernetes.io/revision';

// Kubernetes contexts select a cluster; they must not select a static AWS
// credential source.  EKS exec authentication on the production Dashboard is
// intentionally backed by the host's default credential chain (the EC2
// instance profile), with EKS Access Entries providing Kubernetes access.
const AWS_STATIC_CREDENTIAL_EXEC_ENV_NAMES = new Set([
  'AWS_PROFILE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
]);

interface K8sApis {
  kc: k8s.KubeConfig;
  k8sAppsV1Api: k8s.AppsV1Api;
  k8sCoreV1Api: k8s.CoreV1Api;
  k8sCustomObjectsApi: k8s.CustomObjectsApi;
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
    ].join('|');
  }

  private configureEksExecForHostRole(
    environmentId: string,
    exec: NonNullable<k8s.User['exec']>,
    region: string,
  ) {
    const originalEnv = exec.env || [];
    const sanitizedEnv = originalEnv.filter(
      ({ name }) => !AWS_STATIC_CREDENTIAL_EXEC_ENV_NAMES.has(name),
    );
    const removedEnvNames = originalEnv
      .filter(({ name }) => AWS_STATIC_CREDENTIAL_EXEC_ENV_NAMES.has(name))
      .map(({ name }) => name);

    const originalArgs = exec.args || [];
    const sanitizedArgs = originalArgs.filter(
      (arg, index) =>
        arg !== '--profile' &&
        originalArgs[index - 1] !== '--profile' &&
        !arg.startsWith('--profile='),
    );
    const removedProfileArg = sanitizedArgs.length !== originalArgs.length;

    // Region is cluster metadata rather than a credential. It keeps token
    // generation deterministic while the AWS CLI resolves credentials from
    // the host's default chain (EC2 instance profile in production).
    exec.args = sanitizedArgs;
    exec.env = [
      ...sanitizedEnv.filter(({ name }) => name !== 'AWS_REGION'),
      { name: 'AWS_REGION', value: region },
    ];

    if (removedEnvNames.length || removedProfileArg) {
      this.logger.warn(
        `Ignoring static AWS credential selection in kubeconfig exec for env "${environmentId}": ${[
          ...removedEnvNames,
          ...(removedProfileArg ? ['--profile'] : []),
        ].join(', ')}`,
      );
    }
    this.logger.debug(
      `Using the host default AWS credential chain for Kubeconfig exec provider for env "${environmentId}".`,
    );
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
      this.configureEksExecForHostRole(environmentId, user.exec, env.aws_region);
    }

    const k8sAppsV1Api = kc.makeApiClient(k8s.AppsV1Api);
    const k8sCoreV1Api = kc.makeApiClient(k8s.CoreV1Api);
    const k8sCustomObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
    const k8sNetworkingV1Api = kc.makeApiClient(k8s.NetworkingV1Api);
    const k8sLog = new k8s.Log(kc);

    const apis = { kc, k8sAppsV1Api, k8sCoreV1Api, k8sCustomObjectsApi, k8sNetworkingV1Api, k8sLog };
    this.k8sApiCache.set(environmentId, { fingerprint, apis });

    this.logger.log(
      `Successfully created Kubernetes client for environment: ${environmentId}`,
    );
    return apis;
  }

  /** Read-only contract for the fixed first-phase ServiceMonitor template. */
  async getServiceMonitorTarget(environmentId: string, namespace: string, labelSelector: string, portName: string) {
    const { k8sCoreV1Api } = await this.getK8sApis(environmentId);
    const { body: services } = await k8sCoreV1Api.listNamespacedService(namespace, undefined, undefined, undefined, undefined, labelSelector);
    if (services.items.length !== 1) throw new Error(`expected exactly one matching Service, found ${services.items.length}`);
    const service = services.items[0]; const serviceName = String(service.metadata?.name || '');
    if (!serviceName || !service.spec?.ports?.some(port => port.name === portName)) throw new Error(`matching Service must expose a port named ${portName}`);
    const { body: endpoints } = await k8sCoreV1Api.readNamespacedEndpoints(serviceName, namespace);
    const readyEndpoints = (endpoints.subsets || []).flatMap(subset => (subset.addresses || []).flatMap(address => (subset.ports || []).filter(port => port.name === portName).map(() => address.ip || address.hostname || 'ready')));
    if (!readyEndpoints.length) throw new Error(`matching Service has no Ready endpoints on port ${portName}`);
    return { serviceName, readyEndpointCount: readyEndpoints.length };
  }

  /** Read-only conflict probe for the fixed first-phase PrometheusRule template. */
  async getPrometheusRuleConflicts(environmentId: string, namespace: string, resourceName: string, groupName: string, alertName: string) {
    const { k8sCustomObjectsApi } = await this.getK8sApis(environmentId);
    const { body } = await k8sCustomObjectsApi.listNamespacedCustomObject('monitoring.coreos.com', 'v1', namespace, 'prometheusrules');
    const items = Array.isArray((body as any)?.items) ? (body as any).items : [];
    const conflicts = { resourceName: '', groupName: '', alertName: '' };
    for (const item of items) {
      const currentName = String(item?.metadata?.name || '');
      if (!conflicts.resourceName && currentName === resourceName) conflicts.resourceName = currentName;
      const groups = Array.isArray(item?.spec?.groups) ? item.spec.groups : [];
      for (const group of groups) {
        const currentGroupName = String(group?.name || '');
        if (!conflicts.groupName && currentGroupName === groupName) conflicts.groupName = currentGroupName;
        const rules = Array.isArray(group?.rules) ? group.rules : [];
        for (const rule of rules) {
          const currentAlertName = String(rule?.alert || '');
          if (!conflicts.alertName && currentAlertName === alertName) conflicts.alertName = currentAlertName;
        }
      }
      if (conflicts.resourceName && conflicts.groupName && conflicts.alertName) break;
    }
    return conflicts;
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

  async getDeploymentImageHistory(
    environmentId: string,
    name: string,
    namespace = 'default',
  ) {
    const { k8sAppsV1Api } = await this.getK8sApis(environmentId);
    const [{ body: deployment }, { body: replicaSets }] = await Promise.all([
      k8sAppsV1Api.readNamespacedDeployment(name, namespace),
      k8sAppsV1Api.listNamespacedReplicaSet(namespace),
    ]);
    const deploymentUid = deployment.metadata?.uid;
    const currentImages = (deployment.spec?.template?.spec?.containers || []).map((container) => ({
      name: container.name,
      image: container.image || '',
    }));
    const revisions = replicaSets.items
      .filter((replicaSet) => replicaSet.metadata?.ownerReferences?.some(
        (owner) => owner.kind === 'Deployment' && owner.uid === deploymentUid,
      ))
      .map((replicaSet) => ({
        revision: Number(replicaSet.metadata?.annotations?.[DEPLOYMENT_REVISION_ANNOTATION] || 0),
        replicaSetName: replicaSet.metadata?.name || '',
        createdAt: replicaSet.metadata?.creationTimestamp || null,
        images: (replicaSet.spec?.template?.spec?.containers || []).map((container) => ({
          name: container.name,
          image: container.image || '',
        })),
      }))
      .filter((item) => item.revision > 0 && item.images.length > 0)
      .sort((a, b) => b.revision - a.revision);

    const imageVersions = new Map<string, {
      id: string;
      images: Array<{ name: string; image: string }>;
      revisions: typeof revisions;
      isCurrent: boolean;
    }>();
    for (const revision of revisions) {
      const id = revision.images
        .map((image) => `${image.name}\u0000${image.image}`)
        .sort()
        .join('\u0001');
      const isCurrent = revision.images.length === currentImages.length && revision.images.every(
        (image, index) => image.name === currentImages[index]?.name && image.image === currentImages[index]?.image,
      );
      const existing = imageVersions.get(id);
      if (existing) {
        existing.revisions.push(revision);
        existing.isCurrent = existing.isCurrent || isCurrent;
      } else {
        imageVersions.set(id, { id, images: revision.images, revisions: [revision], isCurrent });
      }
    }

    return {
      deployment: name,
      namespace,
      currentImages,
      imageVersions: Array.from(imageVersions.values()).map((version) => ({
        id: version.id,
        images: version.images,
        isCurrent: version.isCurrent,
        revisions: version.revisions.map(({ revision, replicaSetName, createdAt }) => ({
          revision,
          replicaSetName,
          createdAt,
        })),
      })),
    };
  }

  async rollbackDeploymentImages(
    environmentId: string,
    name: string,
    images: Array<{ name: string; image: string }>,
    namespace = 'default',
  ) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('At least one container image is required.');
    }
    const requestedImages = new Map(images.map((item) => [item.name, item.image]));
    if (requestedImages.size !== images.length || images.some((item) => !item.name || !item.image)) {
      throw new Error('Container names and image references must be non-empty and unique.');
    }
    const { k8sAppsV1Api } = await this.getK8sApis(environmentId);
    const { body: deployment } = await k8sAppsV1Api.readNamespacedDeployment(name, namespace);
    const containers = deployment.spec?.template?.spec?.containers;
    if (!containers?.length) throw new Error(`Deployment "${name}" has no containers.`);
    const currentNames = new Set(containers.map((container) => container.name));
    if (requestedImages.size !== currentNames.size || [...requestedImages.keys()].some((containerName) => !currentNames.has(containerName))) {
      throw new Error('Selected images must match every current deployment container exactly.');
    }
    const previousImages = containers.map((container) => ({ name: container.name, image: container.image || '' }));
    containers.forEach((container) => { container.image = requestedImages.get(container.name)!; });
    await k8sAppsV1Api.replaceNamespacedDeployment(name, namespace, deployment);
    this.logger.log(`Updated only container images for deployment "${name}" in namespace "${namespace}".`);
    return { message: `Deployment ${name} image rollback started successfully.`, previousImages, targetImages: images };
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

  async getIngress(environmentId: string, namespace: string, name: string) {
    const { k8sNetworkingV1Api } = await this.getK8sApis(environmentId);
    try {
      const { body } = await k8sNetworkingV1Api.readNamespacedIngress(name, namespace);
      return body;
    } catch (e: any) {
      if (e?.response?.statusCode === 404) return null;
      throw e;
    }
  }

  async findIngressByHost(environmentId: string, host: string) {
    const { k8sNetworkingV1Api } = await this.getK8sApis(environmentId);
    const { body } = await k8sNetworkingV1Api.listIngressForAllNamespaces();
    const items = Array.isArray(body?.items) ? body.items : [];
    const target = host.trim().toLowerCase();
    for (const item of items) {
      const rules = Array.isArray(item?.spec?.rules) ? item.spec.rules : [];
      const matchedRule = rules.find((rule: any) => String(rule?.host || '').trim().toLowerCase() === target);
      if (matchedRule) {
        return {
          namespace: String(item?.metadata?.namespace || 'default'),
          name: String(item?.metadata?.name || ''),
          host: target,
        };
      }
    }
    return null;
  }

  cloneIngressSpec(source: any, input: { newName: string; newHost: string }) {
    const cloned = JSON.parse(JSON.stringify(source || {}));
    cloned.metadata = cloned.metadata || {};
    delete cloned.metadata.uid;
    delete cloned.metadata.resourceVersion;
    delete cloned.metadata.generation;
    delete cloned.metadata.creationTimestamp;
    delete cloned.metadata.managedFields;
    if (cloned.metadata.annotations) {
      delete cloned.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
    }
    delete cloned.status;

    cloned.metadata.name = input.newName;

    if (Array.isArray(cloned.spec?.rules)) {
      cloned.spec.rules = cloned.spec.rules.map((rule: any) => ({ ...rule, host: input.newHost }));
    }
    if (Array.isArray(cloned.spec?.tls)) {
      cloned.spec.tls = cloned.spec.tls.map((tls: any) => ({
        ...tls,
        hosts: Array.isArray(tls?.hosts) ? tls.hosts.map(() => input.newHost) : tls?.hosts,
      }));
    }
    return cloned;
  }

  async createIngress(environmentId: string, namespace: string, body: any) {
    const { k8sNetworkingV1Api } = await this.getK8sApis(environmentId);
    const { body: created } = await k8sNetworkingV1Api.createNamespacedIngress(namespace, body);
    return created;
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
      form?: Record<string, any>;
      timeoutMs?: number;
      headers?: Record<string, string>;
      expectJson?: boolean;
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

    const useForm = input.form !== undefined;
    const expectJson = input.expectJson !== false;
    const options: request.Options = {
      method: input.method || 'GET',
      uri,
      qs: input.query,
      body: useForm ? undefined : input.body,
      form: useForm ? input.form : undefined,
      json: useForm ? false : expectJson,
      timeout: input.timeoutMs ?? 15000,
      headers: {
        Accept: 'application/json',
        ...(input.headers || {}),
      },
    };
    if (useForm) {
      (options.headers as Record<string, string>)['Content-Type'] =
        'application/x-www-form-urlencoded';
    } else if (input.body !== undefined) {
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
        const normalizedBody =
          typeof body === 'string'
            ? (() => {
                try {
                  return JSON.parse(body);
                } catch {
                  return body;
                }
              })()
            : body;
        if (statusCode < 200 || statusCode >= 300) {
          if (statusCode === 401) {
            this.requestServiceViaKubectlProxy(environmentId, input)
              .then((fallback) => resolve(fallback))
              .catch((fallbackError) => {
                const bodyPreview =
                  typeof normalizedBody === 'string'
                    ? normalizedBody.slice(0, 240)
                    : JSON.stringify(normalizedBody).slice(0, 240);
                this.logger.warn(
                  `[ServiceProxy] fallback failed env=${environmentId} context=${contextName} status=${statusCode} body=${bodyPreview} fallback=${String(
                    (fallbackError as any)?.message || fallbackError,
                  )}`,
                );
                const proxyError: any = new Error(
                  `Service proxy request failed (${statusCode}): ${typeof normalizedBody === 'string' ? normalizedBody : JSON.stringify(normalizedBody)}`,
                );
                proxyError.statusCode = statusCode;
                proxyError.body = normalizedBody;
                proxyError.headers = response?.headers || {};
                reject(proxyError);
              });
            return;
          }
          const bodyPreview =
            typeof normalizedBody === 'string'
              ? normalizedBody.slice(0, 240)
              : JSON.stringify(normalizedBody).slice(0, 240);
          this.logger.warn(
            `[ServiceProxy] non-2xx env=${environmentId} context=${contextName} status=${statusCode} body=${bodyPreview}`,
          );
          const proxyError: any = new Error(
            `Service proxy request failed (${statusCode}): ${typeof normalizedBody === 'string' ? normalizedBody : JSON.stringify(normalizedBody)}`,
          );
          proxyError.statusCode = statusCode;
          proxyError.body = normalizedBody;
          proxyError.headers = response?.headers || {};
          reject(proxyError);
          return;
        }
        this.logger.log(
          `[ServiceProxy] success env=${environmentId} context=${contextName} status=${statusCode}`,
        );
        resolve({
          statusCode,
          body: normalizedBody,
          headers: (response?.headers || {}) as Record<string, any>,
        });
      });
    });
  }

  async requestServiceProxyByKubectl(
    environmentId: string,
    input: {
      namespace: string;
      serviceName: string;
      port: number;
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      query?: Record<string, any>;
      body?: any;
      form?: Record<string, any>;
      timeoutMs?: number;
      headers?: Record<string, string>;
      expectJson?: boolean;
    },
  ): Promise<{ statusCode: number; body: any; headers: Record<string, any> }> {
    return this.requestServiceViaKubectlProxy(environmentId, input);
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
      form?: Record<string, any>;
      timeoutMs?: number;
      headers?: Record<string, string>;
      expectJson?: boolean;
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
      const useForm = input.form !== undefined;
      const expectJson = input.expectJson !== false;
      const options: request.Options = {
        method: input.method || 'GET',
        uri,
        qs: input.query,
        body: useForm ? undefined : input.body,
        form: useForm ? input.form : undefined,
        json: useForm ? false : expectJson,
        timeout: input.timeoutMs ?? 15000,
        headers: {
          Accept: 'application/json',
          ...(input.headers || {}),
        },
      };
      if (useForm) {
        (options.headers as Record<string, string>)['Content-Type'] =
          'application/x-www-form-urlencoded';
      } else if (input.body !== undefined) {
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
          const normalizedBody =
            typeof body === 'string'
              ? (() => {
                  try {
                    return JSON.parse(body);
                  } catch {
                    return body;
                  }
                })()
              : body;
          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `Service proxy fallback request failed (${statusCode}): ${typeof normalizedBody === 'string' ? normalizedBody : JSON.stringify(normalizedBody)}`,
              ),
            );
            return;
          }
          resolve({
            statusCode,
            body: normalizedBody,
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
