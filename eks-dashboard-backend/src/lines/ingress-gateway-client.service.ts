import { Injectable, Logger } from '@nestjs/common';
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

  async cloneIngress(
    environmentId: string,
    input: {
      namespace: string;
      sourceIngressName: string;
      newHost: string;
    },
    context?: IngressGatewayContext,
  ) {
    const requestId = context?.requestId || randomUUID();
    const namespace = process.env.QUERY_CENTER_AGENT_K8S_NAMESPACE || 'default';
    const serviceName =
      process.env.QUERY_CENTER_AGENT_K8S_SERVICE || 'dashboard-db-gateway-agent';
    const servicePort = Number(process.env.QUERY_CENTER_AGENT_K8S_PORT || 8080);
    const timeoutMs = Number(process.env.QUERY_CENTER_GATEWAY_TIMEOUT_MS || 15_000);
    const token = process.env.QUERY_CENTER_AGENT_TOKEN || '';

    this.logger.log(
      `[IngressGateway] forwarding clone via k8s proxy env=${environmentId} target=${namespace}/${serviceName}:${servicePort} requestId=${requestId}`,
    );

    const response = await this.kubernetesService.requestServiceProxy(environmentId, {
      namespace,
      serviceName,
      port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
      method: 'POST',
      path: '/v1/ingress/clone',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
      headers: {
        'X-Environment-Id': environmentId,
        'X-Request-Id': requestId,
        ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
        ...(context?.username ? { 'X-Username': context.username } : {}),
        ...(token ? { 'X-Agent-Token': token } : {}),
      },
      body: input,
    });

    return response.body;
  }
}
