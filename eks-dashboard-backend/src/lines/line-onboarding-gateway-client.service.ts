import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { KubernetesService } from '../kubernetes/kubernetes.service';

export type LineOnboardingGatewayContext = {
  requestId?: string;
  userId?: string;
  username?: string;
};

@Injectable()
export class LineOnboardingGatewayClientService {
  private readonly logger = new Logger(LineOnboardingGatewayClientService.name);

  constructor(private readonly kubernetesService: KubernetesService) {}

  async applyTenantDomain(
    environmentId: string,
    input: { tenantId: number; domain: string },
    context?: LineOnboardingGatewayContext,
  ) {
    return this.postToAgent(environmentId, '/v1/tenant-domain/apply', input, context, 'tenant-domain-apply');
  }

  private async postToAgent(
    environmentId: string,
    path: string,
    body: any,
    context: LineOnboardingGatewayContext | undefined,
    action: string,
  ) {
    const requestId = context?.requestId || randomUUID();
    const namespace = process.env.QUERY_CENTER_AGENT_K8S_NAMESPACE || 'default';
    const serviceName = process.env.QUERY_CENTER_AGENT_K8S_SERVICE || 'dashboard-db-gateway-agent';
    const servicePort = Number(process.env.QUERY_CENTER_AGENT_K8S_PORT || 8080);
    const timeoutMs = Number(process.env.QUERY_CENTER_GATEWAY_TIMEOUT_MS || 15_000);
    const token = process.env.QUERY_CENTER_AGENT_TOKEN || '';

    this.logger.log(
      `[LineOnboardingGateway] forwarding ${action} via k8s proxy env=${environmentId} target=${namespace}/${serviceName}:${servicePort} requestId=${requestId}`,
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
    const message = this.extractErrorMessage(body) || error?.message || 'Line onboarding gateway request failed';

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
