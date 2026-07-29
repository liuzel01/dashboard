import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { EnvironmentsService } from '../environments/environments.service';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import { QueryRequestContext } from './query-request-context';

@Injectable()
export class QueryGatewayClientService {
  private readonly logger = new Logger(QueryGatewayClientService.name);

  constructor(
    private readonly environmentsService: EnvironmentsService,
    private readonly kubernetesService: KubernetesService,
    private readonly siteConf: SiteConfService,
  ) {}

  async isGatewayEnabled() {
    return this.siteConf.getBoolean('query_center.gateway.enabled', false);
  }

  async isGatewayEnabledForEnvironment(environmentId: string) {
    if (!(await this.isGatewayEnabled())) return false;
    const denylist = this.parseList(await this.siteConf.getString('query_center.gateway.env_denylist', ''));
    if (denylist.has(environmentId)) return false;
    const allowlist = this.parseList(
      await this.siteConf.getString('query_center.gateway.env_allowlist', ''),
    );
    if (allowlist.size === 0) return true;
    return allowlist.has(environmentId);
  }

  async aggregate(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId?: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();

    const transport = await this.getGatewayTransport();
    if (transport === 'k8s-proxy') {
      return this.aggregateViaK8sServiceProxy(
        environmentId,
        identifier,
        type,
        tenantId,
        requestId,
        token,
        context,
      );
    }

    return this.aggregateViaDirectUrl(
      environmentId,
      identifier,
      type,
      tenantId,
      requestId,
      token,
      context,
    );
  }

  private async aggregateViaK8sServiceProxy(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId: number | undefined,
    requestId: string,
    token: string,
    context?: QueryRequestContext,
  ) {
    const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
    const timeoutMs = await this.getGatewayTimeoutMs();

    this.logger.log(
      `[QueryGateway] forwarding aggregate via k8s proxy env=${environmentId} target=${namespace}/${serviceName}:${servicePort} requestId=${requestId}`,
    );

    const response = await this.kubernetesService.requestServiceProxy(environmentId, {
      namespace,
      serviceName,
      port:
        Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
      method: 'POST',
      path: '/v1/query/aggregate',
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
      headers: {
        'X-Environment-Id': environmentId,
        'X-Request-Id': requestId,
        ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
        ...(context?.username ? { 'X-Username': context.username } : {}),
        ...(token ? { 'X-Agent-Token': token } : {}),
      },
      body: { identifier, type, tenantId },
    });

    return response.body;
  }

  private async aggregateViaDirectUrl(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId: number | undefined,
    requestId: string,
    token: string,
    context?: QueryRequestContext,
  ) {
    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(
      environmentId,
    );
    if (!baseUrl) return null;

    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/aggregate`;
    const timeoutMs = await this.getGatewayTimeoutMs();

    this.logger.log(
      `[QueryGateway] forwarding aggregate via direct url env=${environmentId} url=${url} requestId=${requestId}`,
    );
    const response = await axios.post(
      url,
      { identifier, type, tenantId },
      {
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async updateUser(
    environmentId: string,
    uid: string,
    tenantId: number,
    data: { email?: string | null; tel?: string | null; tel_country_code?: string | null },
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'PATCH',
        path: `/v1/query/users/${encodeURIComponent(uid)}`,
        body: { tenantId, ...data },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/users/${encodeURIComponent(uid)}`;
    const response = await axios.patch(
      url,
      { tenantId, ...data },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async deactivateUser(
    environmentId: string,
    uid: string,
    tenantId: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path: `/v1/query/users/${encodeURIComponent(uid)}/deactivate`,
        body: { tenantId },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/users/${encodeURIComponent(uid)}/deactivate`;
    const response = await axios.post(
      url,
      { tenantId },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async getTraderInfo(
    environmentId: string,
    uid: string,
    tenantId: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'GET',
        path: `/v1/query/trader/${encodeURIComponent(uid)}`,
        query: { tenantId },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/trader/${encodeURIComponent(uid)}`;
    const response = await axios.get(url, {
      timeout: await this.getGatewayTimeoutMs(),
      params: { tenantId },
      headers: {
        'X-Environment-Id': environmentId,
        'X-Request-Id': requestId,
        ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
        ...(context?.username ? { 'X-Username': context.username } : {}),
        ...(token ? { 'X-Agent-Token': token } : {}),
      },
    });
    return response.data;
  }

  async getOtcMerchantInfo(
    environmentId: string,
    uid: string,
    tenantId: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'GET',
        path: `/v1/query/otc-merchant/${encodeURIComponent(uid)}`,
        query: { tenantId },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/otc-merchant/${encodeURIComponent(uid)}`;
    const response = await axios.get(url, {
      timeout: await this.getGatewayTimeoutMs(),
      params: { tenantId },
      headers: {
        'X-Environment-Id': environmentId,
        'X-Request-Id': requestId,
        ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
        ...(context?.username ? { 'X-Username': context.username } : {}),
        ...(token ? { 'X-Agent-Token': token } : {}),
      },
    });
    return response.data;
  }

  async updateOtcMerchantName(
    environmentId: string,
    uid: string,
    tenantId: number,
    name: string,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'PATCH',
        path: `/v1/query/otc-merchant/${encodeURIComponent(uid)}/name`,
        body: { tenantId, name },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/otc-merchant/${encodeURIComponent(uid)}/name`;
    const response = await axios.patch(
      url,
      { tenantId, name },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async disableOtcUserTrade(
    environmentId: string,
    uid: string,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path: `/v1/query/users/${encodeURIComponent(uid)}/otc-user/disable`,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/users/${encodeURIComponent(uid)}/otc-user/disable`;
    const response = await axios.post(
      url,
      {},
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async enableOtcUserTrade(
    environmentId: string,
    uid: string,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path: `/v1/query/users/${encodeURIComponent(uid)}/otc-user/enable`,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/users/${encodeURIComponent(uid)}/otc-user/enable`;
    const response = await axios.post(
      url,
      {},
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async clearUserInviteBy(
    environmentId: string,
    uid: string,
    tenantId: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path: `/v1/query/users/${encodeURIComponent(uid)}/invite-by/clear`,
        body: { tenantId },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/users/${encodeURIComponent(uid)}/invite-by/clear`;
    const response = await axios.post(
      url,
      { tenantId },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async resetPartnerPassword(
    environmentId: string,
    uid: string,
    tenantId: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path: `/v1/query/users/${encodeURIComponent(uid)}/partner-password/reset`,
        body: { tenantId },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/users/${encodeURIComponent(uid)}/partner-password/reset`;
    const response = await axios.post(
      url,
      { tenantId },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async getRedisKey(
    environmentId: string,
    key: string,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'GET',
        path: '/v1/query/redis-key',
        query: { key },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/redis-key`;
    const response = await axios.get(url, {
      timeout: await this.getGatewayTimeoutMs(),
      params: { key },
      headers: {
        'X-Environment-Id': environmentId,
        'X-Request-Id': requestId,
        ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
        ...(context?.username ? { 'X-Username': context.username } : {}),
        ...(token ? { 'X-Agent-Token': token } : {}),
      },
    });
    return response.data;
  }

  async createRedisKey(
    environmentId: string,
    key: string,
    value: string,
    ttlSeconds?: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'POST',
        path: '/v1/query/redis-key',
        body: { key, value, ttlSeconds },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/redis-key`;
    const response = await axios.post(
      url,
      { key, value, ttlSeconds },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
  }

  async deleteRedisKey(
    environmentId: string,
    key: string,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'DELETE',
        path: '/v1/query/redis-key',
        query: { key },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/redis-key`;
    const response = await axios.delete(url, {
      timeout: await this.getGatewayTimeoutMs(),
      params: { key },
      headers: {
        'X-Environment-Id': environmentId,
        'X-Request-Id': requestId,
        ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
        ...(context?.username ? { 'X-Username': context.username } : {}),
        ...(token ? { 'X-Agent-Token': token } : {}),
      },
    });
    return response.data;
  }

  async updateTraderNickName(
    environmentId: string,
    uid: string,
    nickName: string,
    tenantId: number,
    context?: QueryRequestContext,
  ): Promise<any | null> {
    if (!(await this.isGatewayEnabledForEnvironment(environmentId))) return null;

    const requestId = context?.requestId || randomUUID();
    const token = await this.getAgentToken();
    const transport = await this.getGatewayTransport();

    if (transport === 'k8s-proxy') {
      const { namespace, serviceName, servicePort } = await this.getAgentK8sTarget();
      const timeoutMs = await this.getGatewayTimeoutMs();
      const response = await this.kubernetesService.requestServiceProxy(environmentId, {
        namespace,
        serviceName,
        port: Number.isFinite(servicePort) && servicePort > 0 ? servicePort : 8080,
        method: 'PATCH',
        path: `/v1/query/trader/${encodeURIComponent(uid)}/nick`,
        body: { nick_name: nickName, tenantId },
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000,
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      });
      return response.body;
    }

    const baseUrl = await this.environmentsService.getDbGatewayAgentUrl(environmentId);
    if (!baseUrl) return null;
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/query/trader/${encodeURIComponent(uid)}/nick`;
    const response = await axios.patch(
      url,
      { nick_name: nickName, tenantId },
      {
        timeout: await this.getGatewayTimeoutMs(),
        headers: {
          'X-Environment-Id': environmentId,
          'X-Request-Id': requestId,
          ...(context?.userId ? { 'X-User-Id': context.userId } : {}),
          ...(context?.username ? { 'X-Username': context.username } : {}),
          ...(token ? { 'X-Agent-Token': token } : {}),
        },
      },
    );
    return response.data;
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

  private async getGatewayTransport(): Promise<'k8s-proxy' | 'direct-url'> {
    const mode = (await this.siteConf.getString('query_center.gateway.transport', 'k8s-proxy'))
      .trim()
      .toLowerCase();
    return mode === 'direct-url' ? 'direct-url' : 'k8s-proxy';
  }

  private async getGatewayTimeoutMs() {
    const timeoutMs = await this.siteConf.getNumber('query_center.gateway.timeout_ms', 15_000);
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15_000;
  }

  private parseList(raw?: string) {
    if (!raw) return new Set<string>();
    return new Set(
      String(raw)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
}
