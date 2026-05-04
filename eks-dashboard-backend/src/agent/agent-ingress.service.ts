import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';

@Injectable()
export class AgentIngressService {
  private readonly logger = new Logger(AgentIngressService.name);
  private readonly kc: k8s.KubeConfig;
  private readonly networkingV1Api: k8s.NetworkingV1Api;

  constructor() {
    this.kc = new k8s.KubeConfig();
    try {
      this.kc.loadFromCluster();
      this.logger.log('Loaded Kubernetes config from in-cluster service account');
    } catch (clusterError: any) {
      this.logger.warn(
        `Failed to load in-cluster Kubernetes config, falling back to default kubeconfig: ${String(
          clusterError?.message || clusterError,
        )}`,
      );
      this.kc.loadFromDefault();
    }
    this.networkingV1Api = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  async cloneIngress(input: {
    environmentId: string;
    namespace: string;
    sourceIngressName: string;
    newHost: string;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const environmentId = String(input.environmentId || '').trim();
    const namespace = String(input.namespace || '').trim();
    const sourceIngressName = String(input.sourceIngressName || '').trim();
    const newHost = String(input.newHost || '').trim().toLowerCase();

    if (!namespace) throw new BadRequestException('namespace is required');
    if (!sourceIngressName) throw new BadRequestException('sourceIngressName is required');
    if (!newHost) throw new BadRequestException('newHost is required');

    this.logger.log(
      `[AgentIngressClone] start env=${environmentId || 'none'} requestId=${input.requestId || 'none'} userId=${input.userId || 'none'} username=${input.username || 'none'} source=${namespace}/${sourceIngressName} host=${newHost}`,
    );

    const source = await this.getIngress(namespace, sourceIngressName);
    if (!source) {
      throw new NotFoundException(`source ingress not found: ${namespace}/${sourceIngressName}`);
    }

    const hostConflict = await this.findIngressByHost(newHost);
    if (hostConflict) {
      throw new ConflictException({
        message: `host already exists: ${newHost}`,
        conflictType: 'host',
        conflictIngress: hostConflict,
      });
    }

    const baseName = `${sourceIngressName}-${this.formatTimestamp(new Date())}`;
    const newIngressName = await this.generateAvailableIngressName(namespace, baseName);
    const cloned = this.cloneIngressSpec(source, { newName: newIngressName, newHost });
    const created = await this.networkingV1Api.createNamespacedIngress(namespace, cloned as any);

    this.logger.log(
      `[AgentIngressClone] success env=${environmentId || 'none'} requestId=${input.requestId || 'none'} source=${namespace}/${sourceIngressName} new=${namespace}/${newIngressName} host=${newHost}`,
    );

    return {
      success: true,
      data: {
        newIngressName,
        namespace,
        host: newHost,
        sourceIngressName,
        createdAt: created?.body?.metadata?.creationTimestamp || new Date().toISOString(),
      },
    };
  }

  private async getIngress(namespace: string, name: string) {
    try {
      const { body } = await this.networkingV1Api.readNamespacedIngress(name, namespace);
      return body;
    } catch (e: any) {
      if (e?.response?.statusCode === 404 || e?.body?.code === 404) return null;
      throw e;
    }
  }

  private async findIngressByHost(host: string) {
    const { body } = await this.networkingV1Api.listIngressForAllNamespaces();
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

  private async generateAvailableIngressName(namespace: string, baseName: string) {
    let candidate = baseName;
    for (let i = 0; i < 5; i += 1) {
      const exists = await this.getIngress(namespace, candidate);
      if (!exists) return candidate;
      candidate = `${baseName}-${Math.floor(Math.random() * 90 + 10)}`;
    }
    const finalExists = await this.getIngress(namespace, candidate);
    if (finalExists) {
      throw new ConflictException({
        message: `ingress name already exists: ${candidate}`,
        conflictType: 'name',
        conflictIngress: { namespace, name: candidate },
      });
    }
    return candidate;
  }

  private formatTimestamp(now: Date) {
    const y = String(now.getFullYear()).slice(2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}${hh}${mm}`;
  }

  private cloneIngressSpec(source: any, input: { newName: string; newHost: string }) {
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
}
