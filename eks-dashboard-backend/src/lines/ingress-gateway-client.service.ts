import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { SiteConfService } from '../site-conf/site-conf.service';

export type IngressGatewayContext = {
  requestId?: string;
  userId?: string;
  username?: string;
};

@Injectable()
export class IngressGatewayClientService {
  private readonly logger = new Logger(IngressGatewayClientService.name);

  constructor(
    private readonly kubernetesService: KubernetesService,
    private readonly siteConf: SiteConfService,
  ) {}

  async readTlsSecret(
    environmentId: string,
    input: {
      namespace: string;
      secretName: string;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/tls-secret/read', input, context, 'tls-secret-read');
  }

  async listSourceCandidates(
    environmentId: string,
    input: {
      namespace?: string;
      keyword?: string;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/ingress/source-candidates', input, context, 'source-candidates');
  }

  async resolveSource(
    environmentId: string,
    input: {
      namespace: string;
      lineUrl?: string;
      keyword?: string;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/ingress/resolve-source', input, context, 'resolve-source');
  }

  async resolveTlsSecret(
    environmentId: string,
    input: {
      namespace: string;
      lineUrl: string;
      keyword?: string;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/ingress/resolve-tls-secret', input, context, 'resolve-tls-secret');
  }

  async previewCloneIngress(
    environmentId: string,
    input: {
      namespace: string;
      sourceIngressName: string;
      newHost: string;
      newIngressName?: string;
      tlsSecretMode?: 'new' | 'reuse' | 'custom';
      tlsSecretName?: string;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/ingress/clone-preview', input, context, 'clone-preview');
  }

  async cloneIngress(
    environmentId: string,
    input: {
      namespace: string;
      sourceIngressName: string;
      newHost: string;
      newIngressName?: string;
      tlsSecretMode?: 'new' | 'reuse' | 'custom';
      tlsSecretName?: string;
      confirmed?: boolean;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/ingress/clone', input, context, 'clone');
  }

  async applyIngressManifest(
    environmentId: string,
    input: { manifestYaml: string; sourceIngressName?: string; confirmed: boolean },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(
      environmentId,
      '/v1/ingress/manifest/apply',
      input,
      context,
      input.confirmed ? 'manifest-create' : 'manifest-dry-run',
    );
  }

  private async postToAgent(
    environmentId: string,
    path: string,
    body: any,
    context: IngressGatewayContext | undefined,
    action: string,
  ) {
    const requestId = context?.requestId || randomUUID();
    const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
    const timeoutMs = await this.siteConf.getNumber('query_center.gateway.timeout_ms', 15_000);
    const token = await this.getAgentToken();

    this.logger.log(
      `[IngressGateway] forwarding ${action} via k8s proxy env=${environmentId} target=${namespace}/${serviceName}:${servicePort} requestId=${requestId}`,
    );

    try {
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
        body,
      });

      return response.body;
    } catch (error: any) {
      this.rethrowAgentError(error);
    }
  }

  private async getAgentToken() {
    return (await this.siteConf.getString('query_center.agent.token', '')).trim();
  }

  private async getAgentK8sTarget() {
    const namespace = (await this.siteConf.getString('query_center.agent.k8s_namespace', 'default')).trim() || 'default';
    const serviceName = (await this.siteConf.getString('query_center.agent.k8s_service', 'dashboard-db-gateway-agent')).trim() || 'dashboard-db-gateway-agent';
    const configuredPort = await this.siteConf.getNumber('query_center.agent.k8s_port', 8080);
    const servicePort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 8080;
    return { namespace, serviceName, servicePort };
  }

  private rethrowAgentError(error: any): never {
    const statusCode = Number(error?.statusCode || error?.response?.status);
    const body = error?.body || error?.response?.data;
    const message = this.extractErrorMessage(body) || error?.message || 'Ingress gateway request failed';

    if (statusCode === 400) throw new BadRequestException(message);
    if (statusCode === 404) throw new NotFoundException(message);
    if (statusCode === 409) throw new ConflictException(body || message);
    throw error;
  }

  private extractErrorMessage(body: any) {
    if (!body) return '';
    const message = body.message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;
    if (typeof body === 'string') return body;
    return '';
  }
}
