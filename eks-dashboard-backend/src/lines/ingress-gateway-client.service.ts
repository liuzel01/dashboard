import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { KubernetesService } from '../kubernetes/kubernetes.service';

export type IngressGatewayContext = {
  requestId?: string;
  userId?: string;
  username?: string;
};

@Injectable()
export class IngressGatewayClientService {
  private readonly logger = new Logger(IngressGatewayClientService.name);

  constructor(private readonly kubernetesService: KubernetesService) {}

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

  async cloneIngress(
    environmentId: string,
    input: {
      namespace: string;
      sourceIngressName: string;
      newHost: string;
    },
    context?: IngressGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/ingress/clone', input, context, 'clone');
  }

  private async postToAgent(
    environmentId: string,
    path: string,
    body: any,
    context: IngressGatewayContext | undefined,
    action: string,
  ) {
    const requestId = context?.requestId || randomUUID();
    const namespace = process.env.QUERY_CENTER_AGENT_K8S_NAMESPACE || 'default';
    const serviceName =
      process.env.QUERY_CENTER_AGENT_K8S_SERVICE || 'dashboard-db-gateway-agent';
    const servicePort = Number(process.env.QUERY_CENTER_AGENT_K8S_PORT || 8080);
    const timeoutMs = Number(process.env.QUERY_CENTER_GATEWAY_TIMEOUT_MS || 15_000);
    const token = process.env.QUERY_CENTER_AGENT_TOKEN || '';

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
