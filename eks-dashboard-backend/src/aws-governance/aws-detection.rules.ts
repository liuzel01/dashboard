import { createHash } from 'crypto';
import type { AwsInventoryResource } from './aws-governance.types';

export type AwsFindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AwsRuleMatch = {
  summary: string;
  evidence: Record<string, unknown>;
};

export type AwsDetectionRule = {
  key: string;
  version: number;
  title: string;
  severity: AwsFindingSeverity;
  resourceTypes: string[];
  condition: Record<string, unknown>;
  remediationHint: string;
  evaluate: (
    resource: AwsInventoryResource,
    context: { acmExpiryDays: number },
  ) => AwsRuleMatch | null;
};

const publicRanges = new Set(['0.0.0.0/0', '::/0']);
const requiredTags = ['environment', 'owner'];

export const AWS_DETECTION_RULES: AwsDetectionRule[] = [
  {
    key: 'security-group-public-sensitive-port',
    version: 1,
    title: '安全组向公网开放高风险端口',
    severity: 'CRITICAL',
    resourceTypes: ['ec2:security-group'],
    condition: {
      publicCidrs: [...publicRanges],
      ports: [22, 3389, 3306, 5432, 6379, 9200, 27017],
    },
    remediationHint: '将来源限制到受控网段或通过受控跳板机访问。',
    evaluate: (resource) => {
      const ingress = Array.isArray(resource.normalized.ingress)
        ? (resource.normalized.ingress as any[])
        : [];
      const hits = ingress.filter((rule) => {
        const ranges = [...(rule.ipv4Ranges || []), ...(rule.ipv6Ranges || [])];
        if (!ranges.some((range) => publicRanges.has(String(range))))
          return false;
        const from = Number(rule.fromPort);
        const to = Number(rule.toPort);
        if (String(rule.protocol) === '-1') return true;
        return [22, 3389, 3306, 5432, 6379, 9200, 27017].some(
          (port) => from <= port && to >= port,
        );
      });
      return hits.length
        ? {
            summary: `发现 ${hits.length} 条公网高风险入站规则`,
            evidence: { ingress: hits.slice(0, 20) },
          }
        : null;
    },
  },
  {
    key: 'ebs-volume-unencrypted',
    version: 1,
    title: 'EBS 卷未启用加密',
    severity: 'HIGH',
    resourceTypes: ['ec2:volume'],
    condition: { encrypted: false },
    remediationHint: '通过加密快照迁移到启用 KMS 加密的新卷。',
    evaluate: (resource) =>
      resource.normalized.encrypted === false
        ? {
            summary: '该 EBS 卷未启用静态加密',
            evidence: {
              encrypted: false,
              volumeType: resource.normalized.volumeType,
            },
          }
        : null,
  },
  {
    key: 'rds-instance-public',
    version: 1,
    title: 'RDS 实例允许公网访问',
    severity: 'CRITICAL',
    resourceTypes: ['rds:db-instance'],
    condition: { publiclyAccessible: true },
    remediationHint: '关闭 PubliclyAccessible 并通过私网访问数据库。',
    evaluate: (resource) =>
      resource.normalized.publiclyAccessible === true
        ? {
            summary: '该 RDS 实例配置为公网可访问',
            evidence: { publiclyAccessible: true },
          }
        : null,
  },
  {
    key: 'rds-instance-unencrypted',
    version: 1,
    title: 'RDS 实例未启用存储加密',
    severity: 'HIGH',
    resourceTypes: ['rds:db-instance'],
    condition: { storageEncrypted: false },
    remediationHint: '通过加密快照迁移到启用 KMS 加密的新实例。',
    evaluate: (resource) =>
      resource.normalized.storageEncrypted === false
        ? {
            summary: '该 RDS 实例未启用存储加密',
            evidence: { storageEncrypted: false },
          }
        : null,
  },
  {
    key: 'acm-certificate-expiring',
    version: 1,
    title: 'ACM 证书即将到期',
    severity: 'HIGH',
    resourceTypes: ['acm:certificate'],
    condition: {
      notAfterWithinDays: 'siteconf:aws_governance.detection.acm_expiry_days',
    },
    remediationHint: '确认自动续期条件或提前完成证书替换。',
    evaluate: (resource, context) => {
      const notAfter = Date.parse(String(resource.normalized.notAfter || ''));
      if (!Number.isFinite(notAfter)) return null;
      const remainingDays = Math.ceil((notAfter - Date.now()) / 86_400_000);
      return remainingDays <= context.acmExpiryDays
        ? {
            summary: `证书将在 ${remainingDays} 天内到期`,
            evidence: { notAfter: resource.normalized.notAfter, remainingDays },
          }
        : null;
    },
  },
  {
    key: 'eks-public-endpoint-unrestricted',
    version: 1,
    title: 'EKS 公网 Endpoint 未限制来源',
    severity: 'CRITICAL',
    resourceTypes: ['eks:cluster'],
    condition: {
      endpointPublicAccess: true,
      publicAccessCidrs: ['0.0.0.0/0', '::/0'],
    },
    remediationHint: '限制公网 CIDR，或仅启用私网 Endpoint。',
    evaluate: (resource) => {
      const cidrs = Array.isArray(resource.normalized.publicAccessCidrs)
        ? resource.normalized.publicAccessCidrs.map(String)
        : [];
      return resource.normalized.endpointPublicAccess === true &&
        cidrs.some((cidr) => publicRanges.has(cidr))
        ? {
            summary: 'EKS API 公网入口允许任意来源',
            evidence: { publicAccessCidrs: cidrs },
          }
        : null;
    },
  },
  {
    key: 'cloudtrail-not-logging',
    version: 1,
    title: 'CloudTrail 未处于投递状态',
    severity: 'CRITICAL',
    resourceTypes: ['cloudtrail:trail'],
    condition: { isLogging: false },
    remediationHint: '恢复 Trail 日志投递并核查最近投递错误。',
    evaluate: (resource) =>
      resource.normalized.isLogging === false
        ? {
            summary: 'CloudTrail 当前未投递管理事件',
            evidence: {
              isLogging: false,
              latestDeliveryError: resource.normalized.latestDeliveryError,
            },
          }
        : null,
  },
  {
    key: 'cloudtrail-log-validation-disabled',
    version: 1,
    title: 'CloudTrail 日志完整性校验未启用',
    severity: 'MEDIUM',
    resourceTypes: ['cloudtrail:trail'],
    condition: { logFileValidation: false },
    remediationHint: '启用 Log File Validation 并规划受控归档。',
    evaluate: (resource) =>
      resource.normalized.logFileValidation === false
        ? {
            summary: 'Trail 未启用日志文件完整性校验',
            evidence: { logFileValidation: false },
          }
        : null,
  },
  {
    key: 'required-tags-missing',
    version: 1,
    title: '资源缺少治理标签',
    severity: 'LOW',
    resourceTypes: [
      'ec2:instance',
      'ec2:volume',
      'ec2:security-group',
      'eks:cluster',
    ],
    condition: { requiredTags },
    remediationHint: '补充 environment 和 owner 标签，并纳入创建模板。',
    evaluate: (resource) => {
      const tags =
        resource.normalized.tags && typeof resource.normalized.tags === 'object'
          ? (resource.normalized.tags as Record<string, unknown>)
          : {};
      const lowerKeys = new Set(
        Object.keys(tags).map((key) => key.toLowerCase()),
      );
      const missing = requiredTags.filter((key) => !lowerKeys.has(key));
      return missing.length
        ? {
            summary: `缺少必要标签：${missing.join(', ')}`,
            evidence: { missingTags: missing },
          }
        : null;
    },
  },
];

export const ruleChecksum = (rule: AwsDetectionRule) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        key: rule.key,
        version: rule.version,
        title: rule.title,
        severity: rule.severity,
        resourceTypes: [...rule.resourceTypes].sort(),
        condition: rule.condition,
        remediationHint: rule.remediationHint,
      }),
    )
    .digest('hex');

export const findingFingerprint = (
  ruleKey: string,
  accountId: string,
  resource: AwsInventoryResource,
) =>
  createHash('sha256')
    .update(
      [
        ruleKey,
        accountId,
        resource.region,
        resource.resourceType,
        resource.resourceId,
      ].join('\u0000'),
    )
    .digest('hex');

export const findingStatusOnMatch = (
  status: string,
  exemptUntil: Date | string | null | undefined,
  now = Date.now(),
) => {
  const exemptionExpired =
    status === 'ACCEPTED_RISK' &&
    exemptUntil &&
    new Date(exemptUntil).getTime() <= now;
  return status === 'RESOLVED' || exemptionExpired ? 'REOPENED' : status;
};

export const shouldAutoResolveFinding = (
  status: string,
  matched: boolean,
  collectionComplete: boolean,
) =>
  collectionComplete &&
  !matched &&
  ['OPEN', 'ACKNOWLEDGED', 'REMEDIATING', 'REOPENED'].includes(status);
