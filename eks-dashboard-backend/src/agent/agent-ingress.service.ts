import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import { loadAll, YAMLException } from 'js-yaml';

const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

const HIGH_RISK_ANNOTATIONS: Record<string, string> = {
  'nginx.ingress.kubernetes.io/server-snippet': '会注入 Nginx server 配置。',
  'nginx.ingress.kubernetes.io/configuration-snippet': '会注入 Nginx location 配置。',
  'nginx.ingress.kubernetes.io/auth-url': '会改变认证链路。',
  'nginx.ingress.kubernetes.io/auth-signin': '会改变认证跳转。',
  'nginx.ingress.kubernetes.io/permanent-redirect': '会将请求永久重定向到指定地址。',
  'nginx.ingress.kubernetes.io/rewrite-target': '会重写请求路径。',
  'nginx.ingress.kubernetes.io/whitelist-source-range': '会改变允许访问的来源 IP 范围。',
};

@Injectable()
export class AgentIngressService {
  private readonly logger = new Logger(AgentIngressService.name);
  private readonly kc: k8s.KubeConfig;
  private readonly networkingV1Api: k8s.NetworkingV1Api;
  private readonly coreV1Api: k8s.CoreV1Api;

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
    this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api);
  }

  async readTlsSecret(input: {
    environmentId: string;
    namespace: string;
    secretName: string;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const namespace = String(input.namespace || '').trim();
    const secretName = String(input.secretName || '').trim();
    if (!namespace) throw new BadRequestException('namespace is required');
    if (!secretName) throw new BadRequestException('secretName is required');

    this.logger.log(
      `[AgentTlsSecret] read env=${input.environmentId || 'none'} requestId=${input.requestId || 'none'} namespace=${namespace} secret=${secretName}`,
    );

    let secret: any;
    try {
      const { body } = await this.coreV1Api.readNamespacedSecret(secretName, namespace);
      secret = body;
    } catch (error: any) {
      if (error?.response?.statusCode === 404 || error?.statusCode === 404) {
        throw new NotFoundException(`TLS Secret ${namespace}/${secretName} not found`);
      }
      throw error;
    }

    if (secret.type !== 'kubernetes.io/tls') {
      throw new BadRequestException(`Secret ${namespace}/${secretName} is not kubernetes.io/tls`);
    }
    const crt = secret.data?.['tls.crt'];
    const key = secret.data?.['tls.key'];
    if (!crt || !key) {
      throw new BadRequestException(`Secret ${namespace}/${secretName} missing tls.crt or tls.key`);
    }

    return {
      success: true,
      data: {
        namespace,
        name: secretName,
        cert: Buffer.from(crt, 'base64').toString('utf8'),
        key: Buffer.from(key, 'base64').toString('utf8'),
      },
    };
  }

  async listSourceCandidates(input: {
    environmentId: string;
    namespace?: string;
    keyword?: string;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const namespace = String(input.namespace || '').trim();
    const keyword = String(input.keyword || '').trim().toLowerCase();

    this.logger.log(
      `[AgentIngressCandidates] start env=${input.environmentId || 'none'} requestId=${input.requestId || 'none'} namespace=${namespace || 'all'} keyword=${keyword || 'none'}`,
    );

    const items = await this.listIngressCandidates(namespace, keyword);
    return {
      success: true,
      data: {
        namespace: namespace || null,
        keyword: keyword || null,
        total: items.length,
        items,
      },
    };
  }

  async resolveSource(input: {
    environmentId: string;
    namespace: string;
    lineUrl?: string;
    keyword?: string;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const namespace = String(input.namespace || '').trim();
    const lineHost = input.lineUrl ? this.normalizeToHost(input.lineUrl) : '';
    const keyword = String(input.keyword || 'nginx-web-app').trim().toLowerCase();
    if (!namespace) throw new BadRequestException('namespace is required');

    this.logger.log(
      `[AgentIngressResolve] start env=${input.environmentId || 'none'} requestId=${input.requestId || 'none'} namespace=${namespace} lineHost=${lineHost || 'none'} keyword=${keyword || 'none'}`,
    );

    const candidates = await this.listIngressCandidates(namespace, keyword);
    const exactHost = lineHost
      ? candidates.find((item) => item.ruleHosts.some((host) => host.toLowerCase() === lineHost))
      : undefined;
    const keywordMatched = !exactHost && keyword ? candidates[0] : undefined;
    const selected = exactHost || keywordMatched || candidates[0];
    const matchedBy = exactHost ? 'host' : keywordMatched ? 'keyword' : selected ? 'fallback' : 'none';

    return {
      success: Boolean(selected),
      data: selected
        ? {
            namespace: selected.namespace,
            sourceIngressName: selected.name,
            matchedBy,
            lineHost: lineHost || null,
            candidates,
          }
        : {
            namespace,
            sourceIngressName: null,
            matchedBy,
            lineHost: lineHost || null,
            candidates,
          },
    };
  }

  async resolveTlsSecretForHost(input: {
    environmentId: string;
    namespace: string;
    lineUrl: string;
    keyword?: string;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const namespace = String(input.namespace || '').trim();
    const lineHost = this.normalizeToHost(input.lineUrl);
    if (!namespace) throw new BadRequestException('namespace is required');
    if (!lineHost) throw new BadRequestException('lineUrl is required');

    this.logger.log(
      `[AgentIngressResolveTls] start env=${input.environmentId || 'none'} requestId=${input.requestId || 'none'} namespace=${namespace} lineHost=${lineHost}`,
    );

    const { body } = await this.networkingV1Api.listIngressForAllNamespaces();
    const items = Array.isArray(body?.items) ? body.items : [];
    const matched = items.find((item) => {
      const itemNamespace = String(item?.metadata?.namespace || 'default');
      if (itemNamespace !== namespace) return false;
      const rules = Array.isArray(item?.spec?.rules) ? item.spec.rules : [];
      return rules.some((rule: any) => String(rule?.host || '').trim().toLowerCase() === lineHost);
    });

    if (!matched) {
      throw new NotFoundException(`Ingress for host ${lineHost} not found in namespace ${namespace}`);
    }

    const tlsEntries = Array.isArray(matched?.spec?.tls) ? matched.spec.tls : [];
    const tlsEntry = tlsEntries.find((tls: any) =>
      Array.isArray(tls?.hosts) && tls.hosts.some((host: any) => String(host || '').trim().toLowerCase() === lineHost),
    ) || (tlsEntries.length === 1 ? tlsEntries[0] : null);
    const tlsSecretName = String(tlsEntry?.secretName || '').trim();
    if (!tlsSecretName) {
      throw new NotFoundException(`TLS Secret for host ${lineHost} not found on ingress ${namespace}/${String(matched?.metadata?.name || '')}`);
    }

    let tlsNotBefore: string | null = null;
    let tlsNotAfter: string | null = null;
    try {
      const secret = await this.readTlsSecret({
        environmentId: input.environmentId,
        namespace,
        secretName: tlsSecretName,
        requestId: input.requestId,
        userId: input.userId,
        username: input.username,
      });
      const cert = secret?.data?.cert;
      if (cert) {
        const parsed = new (require('node:crypto').X509Certificate)(cert);
        tlsNotBefore = parsed.validFrom ? new Date(parsed.validFrom).toISOString() : null;
        tlsNotAfter = parsed.validTo ? new Date(parsed.validTo).toISOString() : null;
      }
    } catch (error: any) {
      this.logger.warn(`[AgentIngressResolveTls] failed to inspect tls certificate: ${String(error?.message || error)}`);
    }

    return {
      success: true,
      data: {
        namespace,
        lineHost,
        ingressName: String(matched?.metadata?.name || ''),
        tlsSecretName,
        tlsHosts: Array.isArray(tlsEntry?.hosts) ? tlsEntry.hosts.map((host: any) => String(host || '').trim()).filter(Boolean) : [],
        tlsNotBefore,
        tlsNotAfter,
      },
    };
  }

  async cloneIngress(input: {
    environmentId: string;
    namespace: string;
    sourceIngressName: string;
    newHost: string;
    newIngressName?: string;
    tlsSecretMode?: 'new' | 'reuse' | 'custom';
    tlsSecretName?: string;
    confirmed?: boolean;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const environmentId = String(input.environmentId || '').trim();
    const namespace = String(input.namespace || '').trim();
    const sourceIngressName = String(input.sourceIngressName || '').trim();
    const newHost = String(input.newHost || '').trim().toLowerCase();
    const requestedIngressName = String(input.newIngressName || '').trim().toLowerCase();
    const tlsSecretMode = input.tlsSecretMode || 'new';
    const requestedTlsSecretName = String(input.tlsSecretName || '').trim().toLowerCase();

    if (!namespace) throw new BadRequestException('namespace is required');
    if (!sourceIngressName) throw new BadRequestException('sourceIngressName is required');
    if (!newHost) throw new BadRequestException('newHost is required');
    if (requestedIngressName && !this.isValidK8sResourceName(requestedIngressName)) {
      throw new BadRequestException('newIngressName format is invalid');
    }
    if (!['new', 'reuse', 'custom'].includes(tlsSecretMode)) {
      throw new BadRequestException('tlsSecretMode is invalid');
    }
    if (requestedTlsSecretName && !this.isValidK8sResourceName(requestedTlsSecretName)) {
      throw new BadRequestException('tlsSecretName format is invalid');
    }
    if (tlsSecretMode === 'custom' && !requestedTlsSecretName) {
      throw new BadRequestException('tlsSecretName is required when tlsSecretMode is custom');
    }

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

    const newIngressName = requestedIngressName || `${sourceIngressName}-${this.formatTimestamp(new Date())}`;
    const nameConflict = await this.getIngress(namespace, newIngressName);
    if (nameConflict) {
      throw new ConflictException({
        message: `ingress name already exists: ${newIngressName}`,
        conflictType: 'name',
        conflictIngress: { namespace, name: newIngressName },
      });
    }
    const cloned = this.cloneIngressSpec(source, {
      newName: newIngressName,
      newHost,
      tlsSecretMode,
      tlsSecretName: requestedTlsSecretName || undefined,
    });
    const preview = this.buildIngressPreview({ namespace, sourceIngressName, newIngressName, newHost, cloned });

    if (!input.confirmed) {
      return {
        success: true,
        preview: true,
        data: preview,
      };
    }

    const created = await this.networkingV1Api.createNamespacedIngress(namespace, cloned as any);

    this.logger.log(
      `[AgentIngressClone] success env=${environmentId || 'none'} requestId=${input.requestId || 'none'} source=${namespace}/${sourceIngressName} new=${namespace}/${newIngressName} host=${newHost}`,
    );

    return {
      success: true,
      preview: false,
      data: {
        ...preview,
        createdAt: created?.body?.metadata?.creationTimestamp || new Date().toISOString(),
      },
    };
  }

  async applyIngressManifest(input: {
    environmentId: string;
    manifestYaml: string;
    sourceIngressName?: string;
    confirmed: boolean;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const manifest = this.parseIngressManifest(input.manifestYaml);
    const namespace = String(manifest.metadata?.namespace || '').trim();
    const name = String(manifest.metadata?.name || '').trim();
    const warnings = this.getManifestWarnings(manifest);

    this.logger.log(
      `[AgentIngressManifest] ${input.confirmed ? 'create' : 'dry-run'} env=${input.environmentId || 'none'} requestId=${input.requestId || 'none'} userId=${input.userId || 'none'} username=${input.username || 'none'} source=${input.sourceIngressName || 'none'} target=${namespace}/${name}`,
    );

    const dryRunResult = await this.createIngress(manifest, namespace, true);
    const host = String(manifest.spec?.rules?.[0]?.host || '').trim() || null;
    const data = {
      newIngressName: name,
      namespace,
      host,
      warnings,
      dryRun: true,
      yaml: this.toYaml(manifest),
      dryRunCreationTimestamp: dryRunResult?.metadata?.creationTimestamp || null,
    };

    if (!input.confirmed) {
      return { success: true, preview: true, data };
    }

    const created = await this.createIngress(manifest, namespace, false);
    this.logger.log(
      `[AgentIngressManifest] created env=${input.environmentId || 'none'} requestId=${input.requestId || 'none'} target=${namespace}/${name}`,
    );
    return {
      success: true,
      preview: false,
      data: {
        ...data,
        dryRun: false,
        createdAt: created?.metadata?.creationTimestamp || new Date().toISOString(),
      },
    };
  }

  private async listIngressCandidates(namespace = '', keyword = '') {
    const { body } = await this.networkingV1Api.listIngressForAllNamespaces();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const items = Array.isArray(body?.items) ? body.items : [];
    return items
      .filter((item) => !namespace || String(item?.metadata?.namespace || 'default') === namespace)
      .filter((item) => {
        if (!normalizedKeyword) return true;
        const name = String(item?.metadata?.name || '').toLowerCase();
        const ns = String(item?.metadata?.namespace || '').toLowerCase();
        const hosts = (item?.spec?.rules || []).map((rule: any) => String(rule?.host || '').toLowerCase());
        return ns.includes(normalizedKeyword) || name.includes(normalizedKeyword) || hosts.some((host) => host.includes(normalizedKeyword));
      })
      .map((item) => {
        const ruleHosts = (item?.spec?.rules || [])
          .map((rule: any) => String(rule?.host || '').trim())
          .filter(Boolean);
        const lbAddresses = (item?.status?.loadBalancer?.ingress || [])
          .map((ing: any) => String(ing?.hostname || ing?.ip || '').trim())
          .filter(Boolean);
        return {
          namespace: String(item?.metadata?.namespace || 'default'),
          name: String(item?.metadata?.name || ''),
          createdAt: item?.metadata?.creationTimestamp || null,
          ruleHosts,
          lbAddresses,
        };
      })
      .filter((item) => item.name)
      .sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (bt !== at) return bt - at;
        return a.name.localeCompare(b.name);
      });
  }

  private normalizeToHost(rawLineUrl: string) {
    const value = rawLineUrl.trim().toLowerCase();
    if (!value) return '';
    try {
      const withSchema = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      return new URL(withSchema).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('lineUrl format is invalid');
    }
  }

  private isValidK8sResourceName(name: string) {
    return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) && name.length <= 253;
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

  private formatTimestamp(now: Date) {
    const y = String(now.getFullYear()).slice(2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}${hh}${mm}`;
  }

  private cloneIngressSpec(
    source: any,
    input: { newName: string; newHost: string; tlsSecretMode?: 'new' | 'reuse' | 'custom'; tlsSecretName?: string },
  ) {
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
        secretName: this.resolveTlsSecretName(tls?.secretName, input),
      }));
    }
    return cloned;
  }

  private parseIngressManifest(manifestYaml: string): any {
    const raw = String(manifestYaml || '');
    if (!raw.trim()) throw new BadRequestException('Ingress YAML is required');

    const documents: unknown[] = [];
    try {
      loadAll(raw, (document) => {
        if (document !== undefined && document !== null) documents.push(document);
      });
    } catch (error: any) {
      if (error instanceof YAMLException && error.mark) {
        throw new BadRequestException(`Ingress YAML syntax error at line ${error.mark.line + 1}: ${error.reason}`);
      }
      throw new BadRequestException(`Ingress YAML syntax error: ${String(error?.reason || error?.message || error)}`);
    }

    if (documents.length !== 1) {
      throw new BadRequestException('Ingress YAML must contain exactly one resource document');
    }
    const manifest = documents[0] as any;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new BadRequestException('Ingress YAML root must be an object');
    }
    if (manifest.apiVersion !== 'networking.k8s.io/v1' || manifest.kind !== 'Ingress') {
      throw new BadRequestException('Ingress YAML must be a networking.k8s.io/v1 Ingress');
    }
    if (!manifest.metadata || typeof manifest.metadata !== 'object' || Array.isArray(manifest.metadata)) {
      throw new BadRequestException('Ingress metadata is required');
    }
    const namespace = String(manifest.metadata.namespace || '').trim();
    const name = String(manifest.metadata.name || '').trim();
    if (!namespace || !K8S_RESOURCE_NAME_REGEX.test(namespace)) {
      throw new BadRequestException('Ingress metadata.namespace format is invalid');
    }
    if (!name || !K8S_RESOURCE_NAME_REGEX.test(name)) {
      throw new BadRequestException('Ingress metadata.name format is invalid');
    }
    if (manifest.status !== undefined) {
      throw new BadRequestException('Ingress YAML must not include status');
    }
    const annotations = manifest.metadata.annotations;
    if (annotations !== undefined) {
      if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) {
        throw new BadRequestException('Ingress metadata.annotations must be an object whose values are strings');
      }
      const invalidAnnotationValues = Object.entries(annotations)
        .filter(([, value]) => typeof value !== 'string')
        .map(([key]) => key);
      if (invalidAnnotationValues.length > 0) {
        throw new BadRequestException(
          `Ingress metadata.annotations values must be strings; quote these values: ${invalidAnnotationValues.join(', ')}`,
        );
      }
    }
    const serverManagedFields = ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields', 'selfLink'];
    const presentManagedFields = serverManagedFields.filter((key) => manifest.metadata[key] !== undefined);
    if (presentManagedFields.length > 0) {
      throw new BadRequestException(`Ingress YAML must not include server-managed metadata: ${presentManagedFields.join(', ')}`);
    }
    return manifest;
  }

  private getManifestWarnings(manifest: any) {
    const annotations = manifest?.metadata?.annotations;
    const warnings: Array<{ annotation: string; message: string }> = [];
    if (annotations && typeof annotations === 'object' && !Array.isArray(annotations)) {
      Object.entries(HIGH_RISK_ANNOTATIONS).forEach(([annotation, message]) => {
        if (annotations[annotation] !== undefined) warnings.push({ annotation, message });
      });
    }
    if (manifest?.spec?.ingressClassName) {
      warnings.push({ annotation: 'spec.ingressClassName', message: '会指定或切换 Ingress Controller。' });
    }
    return warnings;
  }

  private async createIngress(manifest: any, namespace: string, dryRun: boolean) {
    try {
      const { body } = await this.networkingV1Api.createNamespacedIngress(
        namespace,
        manifest as k8s.V1Ingress,
        undefined,
        dryRun ? 'All' : undefined,
        'dashboard-line-onboarding',
        'Strict',
      );
      return body;
    } catch (error: any) {
      const statusCode = Number(error?.response?.statusCode || error?.statusCode || error?.response?.status);
      const reason = String(error?.body?.message || error?.response?.body?.message || error?.message || 'Kubernetes rejected the Ingress');
      if (statusCode === 409) throw new ConflictException(`Ingress ${dryRun ? 'dry-run ' : ''}creation conflict: ${reason}`);
      throw new BadRequestException(`Ingress ${dryRun ? 'dry-run validation' : 'creation'} failed: ${reason}`);
    }
  }

  private resolveTlsSecretName(
    sourceSecretName: string | undefined,
    input: { newHost: string; tlsSecretMode?: 'new' | 'reuse' | 'custom'; tlsSecretName?: string },
  ) {
    if (input.tlsSecretMode === 'reuse') return sourceSecretName;
    if (input.tlsSecretMode === 'custom') return input.tlsSecretName;
    return input.tlsSecretName || `${input.newHost.split('.')[0]}-tls`;
  }

  private buildIngressPreview(input: {
    namespace: string;
    sourceIngressName: string;
    newIngressName: string;
    newHost: string;
    cloned: any;
  }) {
    const tlsSecretNames = Array.from(
      new Set((input.cloned?.spec?.tls || []).map((tls: any) => String(tls?.secretName || '').trim()).filter(Boolean)),
    );
    return {
      newIngressName: input.newIngressName,
      namespace: input.namespace,
      host: input.newHost,
      sourceIngressName: input.sourceIngressName,
      tlsSecretNames,
      yaml: this.toYaml(input.cloned),
    };
  }

  private toYaml(value: any, indent = 0): string {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return value
        .map((item) => {
          if (item && typeof item === 'object') {
            const rendered = this.toYaml(item, indent + 2);
            return `${pad}- ${rendered.trimStart()}`;
          }
          return `${pad}- ${this.formatYamlScalar(item)}`;
        })
        .join('\n');
    }
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => {
          if (v && typeof v === 'object') {
            const rendered = this.toYaml(v, indent + 2);
            return `${pad}${key}:\n${rendered}`;
          }
          return `${pad}${key}: ${this.formatYamlScalar(v)}`;
        })
        .join('\n');
    }
    return `${pad}${this.formatYamlScalar(value)}`;
  }

  private formatYamlScalar(value: any) {
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const text = String(value);
    if (!text) return "''";
    // YAML parses these plain strings as non-string scalars. Quote them so
    // Kubernetes annotations remain string-valued after the preview is edited
    // and parsed again by js-yaml.
    if (/^(?:null|true|false|yes|no|on|off|~)$/i.test(text) || /^[-+]?\d+(?:\.\d+)?$/.test(text)) {
      return JSON.stringify(text);
    }
    if (/^[a-zA-Z0-9._/-]+$/.test(text)) return text;
    return JSON.stringify(text);
  }
}
