import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  applyDcdnSecurity,
  getEnvironmentConfig,
  getTenantsForEnvironment,
  getDcdnCasCertificates,
  getDcdnDomainStatus,
  getIngressOriginCandidates,
  getIngressSourceCandidatesForLineOnboarding,
  previewCloneIngressForLineOnboarding,
  cloneIngressForLineOnboarding,
  applyTenantDomainForLineOnboarding,
  provisionDcdnDomain,
  registerSuperAdminLine,
  verifyExternalLine,
  previewRoute53CnameForLineOnboarding,
  syncRoute53CnameForLineOnboarding,
} from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import TenantLinesTable from '../components/TenantLinesTable';
import { buildProbeDetailUrl, getProbeDetailBaseUrl } from '../utils/probeDashboard';

const { Text, Paragraph, Link } = Typography;

type VerifyResult = {
  targetHost: string;
  exists: boolean;
  checkedAt: string;
  sourceApi: string;
  matchedHosts: string[];
  discoveredHosts: string[];
};

type DcdnProvisionResult = {
  domainName: string;
  fetchedAt?: string;
  originDomain: string;
  scope: 'global' | 'domestic' | 'overseas' | null;
  created: boolean;
  cname: string | null;
  domainStatus?: string | null;
  cnameCheckStatus?: number | null;
  cnameCheckPassed?: boolean | null;
  cnameCheckErrMsg?: string | null;
  httpsEnabled?: boolean | null;
  websocketEnabled?: boolean | null;
  wafEnabled?: boolean | null;
  cacheRuleConfigured?: boolean | null;
  certName?: string | null;
  certId?: string | null;
  certRegion?: string | null;
  certType?: string | null;
  certStatus?: string | null;
  certDomainName?: string | null;
  certExpireTime?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  resourceGroupId?: string | null;
  tags?: Array<{ key: string; value: string }>;
  warnings?: string[];
  verifyRequired?: boolean;
  message: string;
};

type DcdnSecurityApplyResult = {
  domainName: string;
  certName: string;
  certSource?: 'k8s-secret' | 'cas' | 'upload';
  certId?: number | null;
  httpsConfigured: boolean;
  websocketConfigured: boolean;
  wafConfigured: boolean;
  cacheConfigured?: boolean;
  warnings: string[];
  errors: string[];
  status?: Partial<DcdnProvisionResult>;
  message: string;
};


type Route53CnameResult = {
  environmentId: string;
  hostedZoneId: string;
  hostedZoneName: string;
  hostedZoneMatchedBy?: string;
  recordName: string;
  recordType: 'CNAME';
  recordValue: string;
  ttl: number;
  action: 'none' | 'create' | 'upsert';
  alreadySynced: boolean;
  existing?: { type: string; ttl: number | null; values: string[] } | null;
  conflicts?: Array<{ type: string; ttl: number | null; values: string[] }>;
  safeToApply: boolean;
  changed?: boolean;
  changeId?: string | null;
  changeStatus?: string | null;
  submittedAt?: string | null;
  message: string;
};

type CasCertificateOption = {
  certificateId: number;
  certName: string;
  commonName: string | null;
  sans: string[];
  matchedDomains: string[];
  wildcardMatched: boolean | null;
  endDate: string | null;
  orderType: string | null;
};

type TenantOption = {
  id: number;
  name: string;
};

type TenantDomainApplyResult = {
  action: 'created' | 'unchanged';
  id?: number;
  tenantId: number;
  domain: string;
  status: number;
  createdAt?: string;
};

type SuperAdminRegisterResult = {
  action: 'created' | 'unchanged' | 'conflict' | 'updated';
  message: string;
  differences?: Array<{ field: string; existing: any; incoming: any }>;
  canUpdate?: boolean;
  connectivityCheck?: { ok: boolean; url: string; status: number } | null;
};

type IngressOriginCandidate = {
  key: string;
  namespace: string;
  ingressName: string;
  originDomain: string;
  lbAddresses: string[];
  ruleHosts: string[];
  createdAt?: string | null;
};

type ResolvedIngressSource = {
  namespace: string;
  sourceIngressName: string;
  matchedBy?: string;
  lineHost?: string | null;
  candidates?: Array<{
    namespace: string;
    name: string;
    ruleHosts?: string[];
    lbAddresses?: string[];
    createdAt?: string | null;
  }>;
};

const DOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const normalizeDomain = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const K8S_RESOURCE_NAME_REGEX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

const formatIngressTimestamp = (date = new Date()) => {
  const y = String(date.getFullYear()).slice(2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}${hh}${mm}`;
};

const toIngressNameHostPrefix = (host: string) =>
  normalizeDomain(host)
    .split('.')[0]
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

const generateDefaultIngressName = (host: string) => {
  const prefix = toIngressNameHostPrefix(host) || 'line';
  return `nginx-web-app-${prefix}-${formatIngressTimestamp()}`;
};

const generateHex = (length = 16) => {
  const bytes = new Uint8Array(Math.max(4, Math.ceil(length / 2)));
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
};

const randomPrefixLength = () => {
  // 12~20位十六进制，降低碰撞概率并保持长度多样性
  return 12 + Math.floor(Math.random() * 9);
};

const LineOnboardingPage: React.FC = () => {
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [rootDomainInput, setRootDomainInput] = useState('sample.com');
  const [confirmedRootDomain, setConfirmedRootDomain] = useState('');

  const [generatedSubdomain, setGeneratedSubdomain] = useState('');
  const [confirmedSubdomain, setConfirmedSubdomain] = useState('');

  const [originDomainInput, setOriginDomainInput] = useState('');
  const [dcdnCname, setDcdnCname] = useState('');
  const [dcdnAutoResult, setDcdnAutoResult] = useState<DcdnProvisionResult | null>(null);
  const [dcdnAutoError, setDcdnAutoError] = useState<string | null>(null);
  const [dcdnProvisioning, setDcdnProvisioning] = useState(false);
  const [dcdnRefreshing, setDcdnRefreshing] = useState(false);
  const [dcdnLastRefreshAt, setDcdnLastRefreshAt] = useState<string | null>(null);
  const [dcdnSecurityApplying, setDcdnSecurityApplying] = useState(false);
  const [ingressCandidatesOpen, setIngressCandidatesOpen] = useState(false);
  const [ingressCandidatesLoading, setIngressCandidatesLoading] = useState(false);
  const [ingressCandidatesError, setIngressCandidatesError] = useState<string | null>(null);
  const [ingressCandidates, setIngressCandidates] = useState<IngressOriginCandidate[]>([]);
  const [selectedIngressCandidateKey, setSelectedIngressCandidateKey] = useState<string | null>(null);
  const [dcdnConfirmed, setDcdnConfirmed] = useState(false);
  const [sslPubInput, setSslPubInput] = useState('');
  const [sslPriInput, setSslPriInput] = useState('');
  const [certNameInput, setCertNameInput] = useState('');
  const [certSource, setCertSource] = useState<'k8s-secret' | 'cas' | 'upload'>('k8s-secret');
  const [casCertMode, setCasCertMode] = useState<'reuse' | 'upload'>('reuse');
  const [casCertLoading, setCasCertLoading] = useState(false);
  const [casCertOptions, setCasCertOptions] = useState<CasCertificateOption[]>([]);
  const [selectedCasCertId, setSelectedCasCertId] = useState<number | undefined>(undefined);
  const [enableWebsocket, setEnableWebsocket] = useState(true);
  const [enableWaf, setEnableWaf] = useState(true);
  const [enableCache, setEnableCache] = useState(true);
  const [securityApplyResult, setSecurityApplyResult] = useState<DcdnSecurityApplyResult | null>(null);
  const [securityApplyError, setSecurityApplyError] = useState<string | null>(null);
  const [route53Previewing, setRoute53Previewing] = useState(false);
  const [route53Syncing, setRoute53Syncing] = useState(false);
  const [route53PreviewResult, setRoute53PreviewResult] = useState<Route53CnameResult | null>(null);
  const [route53SyncResult, setRoute53SyncResult] = useState<Route53CnameResult | null>(null);
  const [route53SyncError, setRoute53SyncError] = useState<string | null>(null);

  const [ingressApplied, setIngressApplied] = useState(false);
  const [ingressApplying, setIngressApplying] = useState(false);
  const [ingressApplyError, setIngressApplyError] = useState<string | null>(null);
  const [ingressApplyResult, setIngressApplyResult] = useState<{ newIngressName: string; namespace: string; host: string } | null>(null);
  const [resolvedIngressSource, setResolvedIngressSource] = useState<ResolvedIngressSource | null>(null);
  const [sourceIngressLoading, setSourceIngressLoading] = useState(false);
  const [sourceIngressError, setSourceIngressError] = useState<string | null>(null);
  const [selectedSourceIngressKey, setSelectedSourceIngressKey] = useState<string>('');
  const [newIngressNameInput, setNewIngressNameInput] = useState('');
  const [tlsSecretNameInput, setTlsSecretNameInput] = useState('');
  const [ingressPreviewLoading, setIngressPreviewLoading] = useState(false);
  const [ingressPreviewError, setIngressPreviewError] = useState<string | null>(null);
  const [ingressPreviewResult, setIngressPreviewResult] = useState<{
    newIngressName: string;
    namespace: string;
    host: string;
    sourceIngressName: string;
    tlsSecretNames?: string[];
    yaml?: string;
  } | null>(null);
  const [superAdminRegistered, setSuperAdminRegistered] = useState(false);
  const [superAdminLineZh, setSuperAdminLineZh] = useState('');
  const [superAdminLineEn, setSuperAdminLineEn] = useState('');
  const [superAdminLineStatus, setSuperAdminLineStatus] = useState(false);
  const [superAdminRegistering, setSuperAdminRegistering] = useState(false);
  const [superAdminActivating, setSuperAdminActivating] = useState(false);
  const [superAdminRegisterError, setSuperAdminRegisterError] = useState<string | null>(null);
  const [superAdminRegisterResult, setSuperAdminRegisterResult] = useState<SuperAdminRegisterResult | null>(null);
  const [superAdminPendingUpdate, setSuperAdminPendingUpdate] = useState(false);
  const [superAdminLinesOpen, setSuperAdminLinesOpen] = useState(false);
  const [superAdminLinesReloadKey, setSuperAdminLinesReloadKey] = useState(0);
  const [, setConnectivityChecked] = useState(false);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | undefined>(undefined);
  const [, setSqlConfirmed] = useState(false);
  const [tenantDomainApplying, setTenantDomainApplying] = useState(false);
  const [tenantDomainApplyError, setTenantDomainApplyError] = useState<string | null>(null);
  const [tenantDomainApplyResult, setTenantDomainApplyResult] = useState<TenantDomainApplyResult | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [superAdminUrl, setSuperAdminUrl] = useState<string>('');
  const [superAdminLoading, setSuperAdminLoading] = useState(false);

  const superAdminLineUrl = confirmedSubdomain ? `https://${confirmedSubdomain}` : '';
  const superAdminOtcUrl = confirmedSubdomain ? `https://${confirmedSubdomain}/otc` : '';
  const connectivityUrl = confirmedSubdomain ? `https://${confirmedSubdomain}/pro/p/symbol/list` : '';
  const probeDetailBaseUrl = getProbeDetailBaseUrl();
  const probeDetailUrl = buildProbeDetailUrl(superAdminLineUrl) || probeDetailBaseUrl;
  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId),
    [tenants, selectedTenantId],
  );
  const tenantIdNormalized = selectedTenantId ? String(selectedTenantId) : '{租户ID}';
  const insertSql = confirmedSubdomain
    ? `INSERT INTO tenant_domain (tenant_id, domian, status, created_time) VALUES (${tenantIdNormalized}, '${confirmedSubdomain}', 1, NOW());`
    : "INSERT INTO tenant_domain (tenant_id, domian, status, created_time) VALUES ({租户ID}, '{步骤2子域名}', 1, NOW());";
  const selectedCasCert = useMemo(
    () => casCertOptions.find((item) => item.certificateId === selectedCasCertId),
    [casCertOptions, selectedCasCertId],
  );
  const showUploadCertificateInputs =
    certSource === 'upload' || (certSource === 'cas' && casCertMode === 'upload');
  const dcdnTlsSecretName = tlsSecretNameInput || (confirmedSubdomain ? `${confirmedSubdomain.split('.')[0]}-tls` : '');

  useEffect(() => {
    const envId = currentEnvironment?.id;
    if (!envId) {
      setSuperAdminUrl('');
      return;
    }
    let cancelled = false;
    const load = async () => {
      setSuperAdminLoading(true);
      try {
        const cfg = (await getEnvironmentConfig(envId)) as { super_admin_url?: string };
        if (!cancelled) {
          setSuperAdminUrl((cfg?.super_admin_url || '').trim());
        }
      } catch {
        if (!cancelled) {
          setSuperAdminUrl('');
        }
      } finally {
        if (!cancelled) {
          setSuperAdminLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [currentEnvironment?.id]);

  useEffect(() => {
    const envId = currentEnvironment?.id;
    setSqlConfirmed(false);
    setTenantDomainApplyError(null);
    setTenantDomainApplyResult(null);
    setVerifyResult(null);
    setVerifyError(null);
    setSuperAdminLinesOpen(false);
    if (!envId) {
      setTenants([]);
      setSelectedTenantId(undefined);
      setTenantLoadError(null);
      return;
    }
    let cancelled = false;
    const loadTenants = async () => {
      setTenantLoading(true);
      setTenantLoadError(null);
      try {
        const data = (await getTenantsForEnvironment()) as TenantOption[];
        const normalized = Array.isArray(data)
          ? data
              .map((item) => ({
                id: Number(item.id),
                name: String(item.name || ''),
              }))
              .filter((item) => Number.isInteger(item.id) && item.id > 0)
          : [];
        if (cancelled) return;
        setTenants(normalized);
        setSelectedTenantId((prev) => {
          if (prev && normalized.some((item) => item.id === prev)) return prev;
          return normalized[0]?.id;
        });
      } catch (error: any) {
        if (cancelled) return;
        setTenants([]);
        setSelectedTenantId(undefined);
        const backendMsg = error?.response?.data?.message;
        const msg = Array.isArray(backendMsg) ? backendMsg.join('; ') : backendMsg || '加载租户列表失败';
        setTenantLoadError(msg);
      } finally {
        if (!cancelled) {
          setTenantLoading(false);
        }
      }
    };
    loadTenants();
    return () => {
      cancelled = true;
    };
  }, [currentEnvironment?.id]);

  useEffect(() => {
    if (!confirmedSubdomain) {
      setSuperAdminLineZh('');
      setSuperAdminLineEn('');
      return;
    }
    const prefix = confirmedSubdomain.split('.')[0] || confirmedSubdomain;
    setSuperAdminLineZh(`线路-${prefix}`);
    setSuperAdminLineEn(prefix);
  }, [confirmedSubdomain]);
  const toStatusText = (value: boolean | null | undefined) => {
    if (value === true) return '已开启';
    if (value === false) return '未开启';
    return '未知';
  };
  const toDomainStatusTag = (value?: string | null) => {
    const raw = (value || '').toLowerCase();
    if (!raw) return <Tag>未知</Tag>;
    if (raw.includes('online') || raw.includes('running') || raw.includes('check_success')) {
      return <Tag color="green">{value}</Tag>;
    }
    if (raw.includes('configuring') || raw.includes('checking') || raw.includes('pending')) {
      return <Tag color="orange">{value}</Tag>;
    }
    if (raw.includes('offline') || raw.includes('failed') || raw.includes('illegal')) {
      return <Tag color="red">{value}</Tag>;
    }
    return <Tag color="blue">{value}</Tag>;
  };
  const toCnameStatusTag = (status?: number | null) => {
    if (status === 0) return <Tag color="green">已配置</Tag>;
    if (typeof status === 'number') return <Tag color="orange">等待配置（{status}）</Tag>;
    return <Tag>未知</Tag>;
  };
  const toCertStatusText = (value?: string | null) => {
    const raw = (value || '').toLowerCase();
    if (!raw) return '-';
    if (raw === 'bound') return '已绑定';
    if (raw.includes('enabled') || raw.includes('online') || raw.includes('success')) return '已生效';
    if (raw.includes('pending') || raw.includes('wait')) return '处理中';
    if (raw.includes('fail') || raw.includes('error')) return '失败';
    return value;
  };
  const toDisplayTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const stepDone = [
    DOMAIN_REGEX.test(normalizeDomain(rootDomainInput)),
    Boolean(confirmedSubdomain),
    ingressApplied,
    superAdminRegistered && Boolean(tenantDomainApplyResult),
    dcdnConfirmed,
    Boolean(confirmedSubdomain),
    verifyResult?.exists === true,
  ];

  const currentStep = stepDone.findIndex((done) => !done);
  const activeStep = currentStep === -1 ? 6 : currentStep;

  const resetFromStep2 = () => {
    setGeneratedSubdomain('');
    setConfirmedSubdomain('');
    setCasCertOptions([]);
    setSelectedCasCertId(undefined);
    setDcdnCname('');
    setDcdnConfirmed(false);
    setRoute53PreviewResult(null);
    setRoute53SyncResult(null);
    setRoute53SyncError(null);
    setIngressApplied(false);
    setSuperAdminRegistered(false);
    setSuperAdminRegisterError(null);
    setSuperAdminRegisterResult(null);
    setSuperAdminPendingUpdate(false);
    setConnectivityChecked(false);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
  };

  const resetFromStep3 = () => {
    setOriginDomainInput('');
    setIngressCandidatesOpen(false);
    setIngressCandidatesLoading(false);
    setIngressCandidatesError(null);
    setIngressCandidates([]);
    setSelectedIngressCandidateKey(null);
    setDcdnCname('');
    setDcdnAutoResult(null);
    setDcdnAutoError(null);
    setDcdnProvisioning(false);
    setDcdnRefreshing(false);
    setDcdnLastRefreshAt(null);
    setDcdnSecurityApplying(false);
    setSslPubInput('');
    setSslPriInput('');
    setCertNameInput('');
    setCertSource('k8s-secret');
    setCasCertMode('reuse');
    setCasCertLoading(false);
    setCasCertOptions([]);
    setSelectedCasCertId(undefined);
    setEnableWebsocket(true);
    setEnableWaf(true);
    setEnableCache(true);
    setSecurityApplyResult(null);
    setSecurityApplyError(null);
    setDcdnConfirmed(false);
    setRoute53PreviewResult(null);
    setRoute53SyncResult(null);
    setRoute53SyncError(null);
    setIngressApplied(false);
    setSuperAdminRegistered(false);
    setSuperAdminRegisterError(null);
    setSuperAdminRegisterResult(null);
    setSuperAdminPendingUpdate(false);
    setConnectivityChecked(false);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
  };

  const handleGenerateSubdomain = () => {
    const rootDomain = normalizeDomain(rootDomainInput);
    if (!DOMAIN_REGEX.test(rootDomain)) {
      message.warning('请先输入合法一级域名');
      return;
    }
    if (rootDomain !== confirmedRootDomain) {
      resetFromStep2();
      setConfirmedRootDomain(rootDomain);
    }
    const prefix = generateHex(randomPrefixLength());
    const subdomain = `${prefix}.${rootDomain}`;
    setGeneratedSubdomain(subdomain);
    if (subdomain !== confirmedSubdomain) {
      resetFromStep3();
    }
    setResolvedIngressSource(null);
    setSourceIngressError(null);
    setSelectedSourceIngressKey('');
    setNewIngressNameInput(generateDefaultIngressName(subdomain));
    setConfirmedSubdomain(subdomain);
  };

  const resetStep3Runtime = () => {
    setIngressCandidatesOpen(false);
    setIngressCandidatesLoading(false);
    setIngressCandidatesError(null);
    setIngressCandidates([]);
    setSelectedIngressCandidateKey(null);
    setResolvedIngressSource(null);
    setSourceIngressLoading(false);
    setSourceIngressError(null);
    setSelectedSourceIngressKey('');
    setNewIngressNameInput('');
    setDcdnAutoResult(null);
    setDcdnAutoError(null);
    setDcdnLastRefreshAt(null);
    setDcdnCname('');
    setSecurityApplyError(null);
    setSecurityApplyResult(null);
    setDcdnConfirmed(false);
    setRoute53PreviewResult(null);
    setRoute53SyncResult(null);
    setRoute53SyncError(null);
    setSelectedCasCertId(undefined);
  };

  const readTextFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'utf-8');
    });

  const handleFileImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'sslPub' | 'sslPri',
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content = await readTextFile(file);
      if (!content.trim()) {
        message.error('证书文件内容为空');
        return;
      }
      if (target === 'sslPub') {
        setSslPubInput(content);
      } else {
        setSslPriInput(content);
      }
      message.success(`已读取文件：${file.name}`);
    } catch {
      message.error('读取文件失败，请重试');
    }
  };

  const handleLoadCasCertificates = async () => {
    if (!confirmedRootDomain) {
      message.warning('请先输入合法一级域名');
      return;
    }
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2并确认当前 DCDN 子域名');
      return;
    }
    setCasCertLoading(true);
    try {
      const resp = (await getDcdnCasCertificates(confirmedRootDomain, confirmedSubdomain)) as {
        certificates?: CasCertificateOption[];
        total?: number;
      };
      const list = Array.isArray(resp?.certificates) ? resp.certificates : [];
      setCasCertOptions(list);
      if (list.length > 0) {
        setSelectedCasCertId(list[0].certificateId);
        message.success(`已加载 ${list.length} 个可复用 CAS 证书`);
      } else {
        setSelectedCasCertId(undefined);
        message.warning('未找到可复用的 CAS 证书，请切换为“上传新证书到CAS”');
      }
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '加载 CAS 证书列表失败';
      message.error(msg);
      setCasCertOptions([]);
      setSelectedCasCertId(undefined);
    } finally {
      setCasCertLoading(false);
    }
  };

  const handleLoadIngressOriginCandidates = async () => {
    setIngressCandidatesLoading(true);
    setIngressCandidatesError(null);
    try {
      const resp = (await getIngressOriginCandidates({
        keyword: 'nginx-web-app',
      })) as {
        items?: Array<{
          namespace: string;
          name: string;
          createdAt?: string | null;
          lbAddresses?: string[];
          ruleHosts?: string[];
          originCandidates?: string[];
        }>;
      };
      const deduped = new Map<string, IngressOriginCandidate>();
      (resp?.items || []).forEach((item) => {
        const key = `${item.namespace}/${item.name}`;
        if (deduped.has(key)) return;
        const lbAddresses = Array.isArray(item.lbAddresses) ? item.lbAddresses : [];
        const ruleHosts = Array.isArray(item.ruleHosts) ? item.ruleHosts : [];
        const originCandidates = Array.isArray(item.originCandidates) ? item.originCandidates : [];
        const preferredOrigin = normalizeDomain(
          lbAddresses[0] || ruleHosts[0] || originCandidates[0] || '',
        );
        if (!preferredOrigin) return;
        deduped.set(key, {
          key,
          namespace: item.namespace,
          ingressName: item.name,
          originDomain: preferredOrigin,
          lbAddresses,
          ruleHosts,
          createdAt: item.createdAt || null,
        });
      });
      const rows = Array.from(deduped.values());

      setIngressCandidates(rows);
      setSelectedIngressCandidateKey(rows[0]?.key || null);
      setIngressCandidatesOpen(true);
      if (rows.length === 0) {
        setIngressCandidatesError('未找到匹配 nginx-web-app 的 Ingress 源站候选');
      }
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '获取 Ingress 候选源站失败';
      setIngressCandidates([]);
      setSelectedIngressCandidateKey(null);
      setIngressCandidatesError(msg);
      setIngressCandidatesOpen(true);
      message.error(msg);
      return false;
    } finally {
      setIngressCandidatesLoading(false);
    }
  };

  const handleUseSelectedIngressOrigin = () => {
    const selected = ingressCandidates.find((item) => item.key === selectedIngressCandidateKey);
    if (!selected) {
      message.warning('请选择一个源站候选');
      return;
    }
    setOriginDomainInput(selected.originDomain);
    resetStep3Runtime();
    setIngressCandidatesOpen(false);
    message.success(`已选择源站域名：${selected.originDomain}`);
  };

  const handleProvisionDcdn = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    const originHost = normalizeDomain(originDomainInput);
    if (!DOMAIN_REGEX.test(originHost)) {
      message.error('请输入合法源站域名，例如 origin.sample.com');
      return;
    }

    setDcdnProvisioning(true);
    setDcdnAutoError(null);
    setDcdnAutoResult(null);
    setSecurityApplyError(null);
    setSecurityApplyResult(null);
    try {
      const result = (await provisionDcdnDomain({
        domainName: confirmedSubdomain,
        originDomain: originHost,
        scope: 'global',
      })) as DcdnProvisionResult;
      setDcdnAutoResult(result);
      setDcdnLastRefreshAt(result.fetchedAt || new Date().toISOString());
      setDcdnCname(result.cname || '');
      setDcdnConfirmed(true);
      setIngressApplied(false);
      setConnectivityChecked(false);
      setSqlConfirmed(false);
      setVerifyResult(null);
      setVerifyError(null);
      message.success(result.created ? 'DCDN 域名创建成功' : 'DCDN 域名已存在，已获取当前信息');
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || 'DCDN 自动创建失败';
      setDcdnAutoError(msg);
      setDcdnAutoResult(null);
      setDcdnConfirmed(false);
      message.error(msg);
      return false;
    } finally {
      setDcdnProvisioning(false);
    }
  };

  const handleRefreshDcdnStatus = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    setDcdnRefreshing(true);
    setDcdnAutoError(null);
    try {
      const status = (await getDcdnDomainStatus(confirmedSubdomain)) as any;
      setDcdnAutoResult((prev) => ({
        domainName: status.domainName || confirmedSubdomain,
        fetchedAt: status.fetchedAt || new Date().toISOString(),
        originDomain: status.originDomain || prev?.originDomain || originDomainInput || '-',
        scope: status.scope || prev?.scope || 'global',
        created: prev?.created ?? false,
        cname: status.cname || prev?.cname || null,
        domainStatus: status.domainStatus || null,
        httpsEnabled: status.httpsEnabled ?? prev?.httpsEnabled ?? null,
        websocketEnabled: status.websocketEnabled ?? prev?.websocketEnabled ?? null,
        wafEnabled: status.wafEnabled ?? prev?.wafEnabled ?? null,
        createdAt: status.createdAt || null,
        updatedAt: status.updatedAt || null,
        resourceGroupId: status.resourceGroupId || null,
        tags: Array.isArray(status.tags) ? status.tags : [],
        warnings: Array.isArray(status.warnings) ? status.warnings : [],
        cnameCheckStatus:
          typeof status.cnameCheckStatus === 'number' ? status.cnameCheckStatus : prev?.cnameCheckStatus ?? null,
        cnameCheckPassed:
          typeof status.cnameCheckPassed === 'boolean'
            ? status.cnameCheckPassed
            : prev?.cnameCheckPassed ?? null,
        cnameCheckErrMsg: status.cnameCheckErrMsg || prev?.cnameCheckErrMsg || null,
        certName: status.certName || prev?.certName || null,
        certId: status.certId || prev?.certId || null,
        certRegion: status.certRegion || prev?.certRegion || null,
        certType: status.certType || prev?.certType || null,
        certStatus: status.certStatus || prev?.certStatus || null,
        certDomainName: status.certDomainName || prev?.certDomainName || null,
        certExpireTime: status.certExpireTime || prev?.certExpireTime || null,
        verifyRequired: !status.cname,
        message: '已刷新 DCDN 域名状态',
      }));
      if (status.cname) {
        setDcdnCname(status.cname);
      }
      setDcdnLastRefreshAt(status.fetchedAt || new Date().toISOString());
      message.success('已刷新 DCDN 域名状态');
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '刷新 DCDN 状态失败';
      setDcdnAutoError(msg);
      message.error(msg);
      return false;
    } finally {
      setDcdnRefreshing(false);
    }
  };

  const handleApplyDcdnSecurity = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    const usingUploadMaterial = certSource === 'upload' || (certSource === 'cas' && casCertMode === 'upload');
    if (certSource === 'k8s-secret' && !dcdnTlsSecretName) {
      message.error('请先完成步骤3并确认 TLS Secret 名称');
      return;
    }
    if (usingUploadMaterial && (!sslPubInput.trim() || !sslPriInput.trim())) {
      message.error('请提供 cert.crt 与 privkey.key 内容');
      return;
    }
    if (certSource === 'cas' && casCertMode === 'reuse' && !selectedCasCertId) {
      message.error('请选择一个可复用的 CAS 证书');
      return;
    }
    setDcdnSecurityApplying(true);
    setSecurityApplyError(null);
    setSecurityApplyResult(null);
    try {
      const result = (await applyDcdnSecurity({
        domainName: confirmedSubdomain,
        sslPub: usingUploadMaterial ? sslPubInput.trim() : undefined,
        sslPri: usingUploadMaterial ? sslPriInput.trim() : undefined,
        certName: certNameInput.trim() || undefined,
        certSource,
        tlsSecretName: certSource === 'k8s-secret' ? dcdnTlsSecretName : undefined,
        tlsSecretNamespace: certSource === 'k8s-secret' ? 'default' : undefined,
        casCertificateId: certSource === 'cas' && casCertMode === 'reuse' ? selectedCasCertId : undefined,
        casCertificateName:
          certSource === 'cas' && casCertMode === 'reuse' ? selectedCasCert?.certName : undefined,
        enableWebsocket,
        enableWaf,
        enableCache,
      })) as DcdnSecurityApplyResult;
      setSecurityApplyResult(result);
      if (result.status) {
        setDcdnAutoResult((prev) => ({
          domainName: result.status?.domainName || prev?.domainName || confirmedSubdomain,
          fetchedAt: result.status?.fetchedAt || new Date().toISOString(),
          originDomain: result.status?.originDomain || prev?.originDomain || originDomainInput || '-',
          scope: (result.status?.scope as DcdnProvisionResult['scope']) || prev?.scope || 'global',
          created: prev?.created ?? false,
          cname: result.status?.cname || prev?.cname || null,
          domainStatus: result.status?.domainStatus || prev?.domainStatus || null,
          httpsEnabled: result.status?.httpsEnabled ?? prev?.httpsEnabled ?? null,
          websocketEnabled: result.status?.websocketEnabled ?? prev?.websocketEnabled ?? null,
          wafEnabled:
            result.status?.wafEnabled ??
            (result.wafConfigured ? true : prev?.wafEnabled ?? null),
          cacheRuleConfigured:
            result.status?.cacheRuleConfigured ??
            (result.cacheConfigured ? true : prev?.cacheRuleConfigured ?? null),
          createdAt: result.status?.createdAt || prev?.createdAt || null,
          updatedAt: result.status?.updatedAt || prev?.updatedAt || null,
          resourceGroupId: result.status?.resourceGroupId || prev?.resourceGroupId || null,
          tags: Array.isArray(result.status?.tags) ? result.status.tags : prev?.tags || [],
          warnings: Array.isArray(result.status?.warnings) ? result.status.warnings : prev?.warnings || [],
          cnameCheckStatus:
            typeof result.status?.cnameCheckStatus === 'number'
              ? result.status.cnameCheckStatus
              : prev?.cnameCheckStatus ?? null,
          cnameCheckPassed:
            typeof result.status?.cnameCheckPassed === 'boolean'
              ? result.status.cnameCheckPassed
              : prev?.cnameCheckPassed ?? null,
          cnameCheckErrMsg: result.status?.cnameCheckErrMsg || prev?.cnameCheckErrMsg || null,
          certName: result.status?.certName || prev?.certName || null,
          certId: result.status?.certId || prev?.certId || null,
          certRegion: result.status?.certRegion || prev?.certRegion || null,
          certType: result.status?.certType || prev?.certType || null,
          certStatus: result.status?.certStatus || prev?.certStatus || null,
          certDomainName: result.status?.certDomainName || prev?.certDomainName || null,
          certExpireTime: result.status?.certExpireTime || prev?.certExpireTime || null,
          verifyRequired: !result.status?.cname,
          message: result.message,
        }));
      }
      setDcdnLastRefreshAt(result.status?.fetchedAt || new Date().toISOString());
      if (result.errors?.length) {
        message.warning('安全配置部分失败，请查看错误详情');
      } else {
        message.success('HTTPS/WebSocket/WAF/缓存 配置完成');
      }
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '应用 HTTPS/WebSocket/WAF/缓存 失败';
      setSecurityApplyError(msg);
      message.error(msg);
      return false;
    } finally {
      setDcdnSecurityApplying(false);
    }
  };


  const buildRoute53Payload = () => {
    const cnameValue = normalizeDomain(dcdnCname || dcdnAutoResult?.cname || '');
    return {
      rootDomain: confirmedRootDomain,
      domainName: confirmedSubdomain,
      cnameValue,
    };
  };

  const handlePreviewRoute53Cname = async () => {
    if (!confirmedRootDomain || !confirmedSubdomain) {
      message.warning('请先完成步骤1和步骤2');
      return;
    }
    const payload = buildRoute53Payload();
    if (!payload.cnameValue) {
      message.error('请先获取或录入 DCDN 返回的 CNAME');
      return;
    }
    setRoute53Previewing(true);
    setRoute53SyncError(null);
    try {
      const result = (await previewRoute53CnameForLineOnboarding(payload)) as Route53CnameResult;
      setRoute53PreviewResult(result);
      setRoute53SyncResult(null);
      if (result.safeToApply) {
        message.success(result.message || 'Route53 CNAME 预览完成');
      } else {
        message.warning(result.message || 'Route53 CNAME 存在冲突');
      }
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || 'Route53 CNAME 预览失败';
      setRoute53SyncError(msg);
      setRoute53PreviewResult(null);
      message.error(msg);
      return false;
    } finally {
      setRoute53Previewing(false);
    }
  };

  const handleSyncRoute53Cname = async () => {
    if (!confirmedRootDomain || !confirmedSubdomain) {
      message.warning('请先完成步骤1和步骤2');
      return;
    }
    const payload = buildRoute53Payload();
    if (!payload.cnameValue) {
      message.error('请先获取或录入 DCDN 返回的 CNAME');
      return;
    }
    setRoute53Syncing(true);
    setRoute53SyncError(null);
    try {
      const result = (await syncRoute53CnameForLineOnboarding({
        ...payload,
        confirmed: true,
      })) as Route53CnameResult;
      setRoute53PreviewResult(result);
      setRoute53SyncResult(result);
      message.success(result.changed ? 'Route53 CNAME 同步已提交' : 'Route53 CNAME 已存在，无需变更');
      await handleRefreshDcdnStatus();
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || 'Route53 CNAME 同步失败';
      setRoute53SyncError(msg);
      message.error(msg);
      return false;
    } finally {
      setRoute53Syncing(false);
    }
  };

  const handleConfirmDcdn = () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    if (!dcdnCname.trim()) {
      message.error('请先录入 DCDN 返回的 CNAME');
      return;
    }
    setDcdnAutoResult((prev) =>
      prev
        ? prev
        : {
            domainName: confirmedSubdomain,
            originDomain: normalizeDomain(originDomainInput || confirmedSubdomain),
            scope: 'global',
            created: false,
            cname: dcdnCname.trim(),
            domainStatus: null,
            verifyRequired: false,
            message: '手工确认 DCDN CNAME',
          },
    );
    setDcdnAutoError(null);
    setDcdnConfirmed(true);
    setIngressApplied(false);
    setSuperAdminRegistered(false);
    setSuperAdminRegisterError(null);
    setSuperAdminRegisterResult(null);
    setSuperAdminPendingUpdate(false);
    setConnectivityChecked(false);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已确认 DCDN 配置');
  };

  const handleLoadSourceIngressCandidates = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先生成并确认可用的线路域名');
      return false;
    }
    setSourceIngressLoading(true);
    setSourceIngressError(null);
    setResolvedIngressSource(null);
    setSelectedSourceIngressKey('');
    try {
      const candidatesResp = (await getIngressSourceCandidatesForLineOnboarding({
        environmentId: currentEnvironment?.id || '',
        namespace: 'default',
        keyword: 'nginx-web-app',
      })) as {
        success?: boolean;
        data?: {
          namespace: string;
          keyword?: string | null;
          total?: number;
          items?: NonNullable<ResolvedIngressSource['candidates']>;
        };
      };
      const candidates = candidatesResp?.data?.items || [];
      setResolvedIngressSource({
        namespace: candidatesResp?.data?.namespace || 'default',
        sourceIngressName: candidates[0]?.name || '',
        matchedBy: 'manual-candidates',
        candidates,
      });
      setIngressPreviewResult(null);
      setIngressPreviewError(null);
      if (candidates.length === 0) {
        setSourceIngressError('未找到可用 source ingress 候选');
        return;
      }
      const first = `${candidates[0].namespace}/${candidates[0].name}`;
      setSelectedSourceIngressKey(first);
      if (!newIngressNameInput.trim()) {
        setNewIngressNameInput(generateDefaultIngressName(confirmedSubdomain));
      }
      message.success(`已加载 ${candidates.length} 个 source ingress 候选`);
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || error?.message || '加载 source ingress 候选失败';
      setSourceIngressError(msg);
      message.error(msg);
      return false;
    } finally {
      setSourceIngressLoading(false);
    }
  };

  const validateIngressCloneInputs = () => {
    if (!confirmedSubdomain) {
      message.warning('请先生成并确认可用的线路域名');
      return null;
    }
    if (!selectedSourceIngressKey) {
      message.warning('请先加载并选择 source ingress');
      return null;
    }
    const newIngressName = newIngressNameInput.trim().toLowerCase();
    if (!newIngressName) {
      message.warning('请先确认新 ingress 名称');
      return null;
    }
    if (!K8S_RESOURCE_NAME_REGEX.test(newIngressName)) {
      message.error('新 ingress 名称格式不合法：只能使用小写字母、数字和中划线，且首尾必须是字母或数字');
      return null;
    }
    const tlsSecretName = tlsSecretNameInput.trim().toLowerCase();
    if (tlsSecretName && !K8S_RESOURCE_NAME_REGEX.test(tlsSecretName)) {
      message.error('TLS Secret 名称格式不合法：只能使用小写字母、数字和中划线，且首尾必须是字母或数字');
      return null;
    }
    const [ns, name] = selectedSourceIngressKey.split('/');
    const sourceNamespace = ns || 'default';
    const sourceIngressName = name || '';
    if (!sourceIngressName) {
      message.error('source ingress 选择无效，请重新选择');
      return null;
    }
    return { sourceNamespace, sourceIngressName, newIngressName, tlsSecretName };
  };

  const handlePreviewCloneIngress = async () => {
    const validated = validateIngressCloneInputs();
    if (!validated || !confirmedSubdomain) return;

    setIngressPreviewLoading(true);
    setIngressPreviewError(null);
    setIngressPreviewResult(null);
    setIngressApplyError(null);
    setIngressApplyResult(null);
    setIngressApplied(false);

    try {
      const resp = (await previewCloneIngressForLineOnboarding({
        environmentId: currentEnvironment?.id || '',
        namespace: validated.sourceNamespace,
        sourceIngressName: validated.sourceIngressName,
        newHost: confirmedSubdomain,
        newIngressName: validated.newIngressName,
        tlsSecretMode: 'new',
        ...(validated.tlsSecretName ? { tlsSecretName: validated.tlsSecretName } : {}),
      })) as {
        success?: boolean;
        preview?: boolean;
        data?: {
          newIngressName: string;
          namespace: string;
          host: string;
          sourceIngressName: string;
          tlsSecretNames?: string[];
          yaml?: string;
        };
      };

      if (!resp?.data?.newIngressName) {
        throw new Error('预览结果不完整，请检查后端返回');
      }

      setIngressPreviewResult(resp.data);
      if (!tlsSecretNameInput.trim() && resp.data.tlsSecretNames?.[0]) {
        setTlsSecretNameInput(resp.data.tlsSecretNames[0]);
      }
      message.success('Ingress YAML 预览已生成，请确认后创建');
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || error?.message || '生成 Ingress 预览失败';
      setIngressPreviewError(msg);
      message.error(msg);
      return false;
    } finally {
      setIngressPreviewLoading(false);
    }
  };

  const handleCloneIngressApply = async () => {
    const validated = validateIngressCloneInputs();
    if (!validated || !confirmedSubdomain) return;
    if (!ingressPreviewResult) {
      message.warning('请先生成 Ingress YAML 预览并确认');
      return;
    }

    setIngressApplying(true);
    setIngressApplyError(null);
    setIngressApplyResult(null);

    try {
      const resp = (await cloneIngressForLineOnboarding({
        environmentId: currentEnvironment?.id || '',
        namespace: validated.sourceNamespace,
        sourceIngressName: validated.sourceIngressName,
        newHost: confirmedSubdomain,
        newIngressName: validated.newIngressName,
        tlsSecretMode: 'new',
        ...(validated.tlsSecretName ? { tlsSecretName: validated.tlsSecretName } : {}),
        confirmed: true,
      })) as {
        success?: boolean;
        preview?: boolean;
        data?: { newIngressName: string; namespace: string; host: string };
      };

      if (!resp?.data?.newIngressName) {
        throw new Error('克隆结果不完整，请检查后端返回');
      }

      setIngressApplyResult(resp.data);
      setIngressApplied(true);
      setSuperAdminRegistered(false);
      setSuperAdminRegisterError(null);
      setSuperAdminRegisterResult(null);
      setSuperAdminPendingUpdate(false);
      setConnectivityChecked(false);
      setSqlConfirmed(false);
      setVerifyResult(null);
      setVerifyError(null);
      message.success(`Ingress 创建成功：${resp.data.newIngressName}`);
    } catch (error: any) {
      const status = Number(error?.response?.status);
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || error?.message || 'Ingress 克隆应用失败';

      setIngressApplied(false);
      setIngressApplyError(msg);

      if (status === 404) {
        message.error(`模板 ingress 不存在：${msg}`);
      } else if (status === 409) {
        message.error(`Ingress 冲突：${msg}`);
      } else if (status === 400) {
        message.error(`参数错误：${msg}`);
      } else {
        message.error(msg);
      }
    } finally {
      setIngressApplying(false);
    }
  };

  const doSuperAdminRegistration = async (
    mode: 'detect' | 'update' = 'detect',
    statusOverride?: boolean,
    verifyConnectivity = false,
    options: { showRegisterLoading?: boolean } = {},
  ): Promise<boolean> => {
    if (mode !== 'update' && !dcdnConfirmed) {
      message.warning('请先完成步骤4：DCDN/HTTPS 配置并点击“确认 DCDN 配置”');
      return false;
    }
    if (!confirmedSubdomain) {
      message.warning('请先生成并确认可用的线路域名');
      return false;
    }
    if (!selectedTenantId) {
      message.warning('请先在步骤1选择目标租户');
      return false;
    }
    if (!superAdminLineZh.trim() || !superAdminLineEn.trim()) {
      message.error('请先填写线路中文名和英文名');
      return false;
    }

    const showRegisterLoading = options.showRegisterLoading ?? true;
    if (showRegisterLoading) {
      setSuperAdminRegistering(true);
    }
    setSuperAdminRegisterError(null);
    if (mode !== 'update') {
      setSuperAdminPendingUpdate(false);
      setSuperAdminRegisterResult(null);
    }
    try {
      const result = (await registerSuperAdminLine({
        lineUrl: superAdminLineUrl,
        otcUrl: superAdminOtcUrl,
        zh: superAdminLineZh.trim(),
        en: superAdminLineEn.trim(),
        status: statusOverride ?? superAdminLineStatus,
        tenantId: selectedTenantId,
        mode,
        verifyConnectivity,
      })) as SuperAdminRegisterResult;

      setSuperAdminRegisterResult(result);
      if (result.action === 'conflict') {
        setSuperAdminPendingUpdate(Boolean(result.canUpdate));
        setSuperAdminRegistered(false);
        message.warning(result.message || '检测到已存在差异配置，请确认是否更新');
        return false;
      }

      setSuperAdminPendingUpdate(false);
      setSuperAdminRegistered(true);
      setConnectivityChecked(false);
      setSqlConfirmed(false);
      setVerifyResult(null);
      setVerifyError(null);
      message.success(result.connectivityCheck?.ok ? '连通性检查通过，平台线路已启用' : result.message || '超级后台登记成功');
      return true;
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '超级后台登记失败';
      setSuperAdminRegisterError(msg);
      setSuperAdminRegistered(false);
      message.error(msg);
      return false;
    } finally {
      if (showRegisterLoading) {
        setSuperAdminRegistering(false);
      }
    }
  };

  const handleConfirmSuperAdminRegistration = () => {
    void doSuperAdminRegistration('detect');
  };

  const handleUpdateSuperAdminRegistration = () => {
    void doSuperAdminRegistration('update');
  };

  const handleActivateSuperAdminLine = async () => {
    setSuperAdminActivating(true);
    try {
      const ok = await doSuperAdminRegistration('update', true, true, { showRegisterLoading: false });
      if (ok) {
        setSuperAdminLineStatus(true);
      }
    } finally {
      setSuperAdminActivating(false);
    }
  };

  const handleApplyTenantDomain = async () => {
    if (!selectedTenantId) {
      message.error('请先选择目标租户');
      return;
    }
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    setTenantDomainApplying(true);
    setTenantDomainApplyError(null);
    setTenantDomainApplyResult(null);
    try {
      const resp = (await applyTenantDomainForLineOnboarding({
        environmentId: currentEnvironment?.id || '',
        tenantId: selectedTenantId,
        domain: confirmedSubdomain,
      })) as { success?: boolean; data?: TenantDomainApplyResult };
      if (!resp?.success || !resp?.data) {
        throw new Error('tenant_domain 写入未返回成功结果');
      }
      setTenantDomainApplyResult(resp.data);
      setSqlConfirmed(true);
      setVerifyResult(null);
      setVerifyError(null);
      message.success(resp.data.action === 'created' ? 'tenant_domain 已自动写入' : 'tenant_domain 已存在，无需重复写入');
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || error?.message || '自动写入 tenant_domain 失败';
      setTenantDomainApplyError(msg);
      message.error(msg);
      return false;
    } finally {
      setTenantDomainApplying(false);
    }
  };

  const handleOpenProbeDetail = () => {
    if (!probeDetailUrl) {
      message.error('外部探测详情页地址未配置');
      return;
    }
    window.open(probeDetailUrl, '_blank', 'noopener,noreferrer');
  };

  const handleVerifyExternal = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await verifyExternalLine(confirmedSubdomain);
      setVerifyResult(result as VerifyResult);
      if ((result as VerifyResult).exists) {
        message.success('验收通过：外部 /api/lines 已包含该线路');
      } else {
        message.warning('未在外部 /api/lines 返回结果中找到该线路');
      }
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg) ? backendMsg.join('; ') : backendMsg || '外部 API 验收失败';
      setVerifyError(msg);
      setVerifyResult(null);
      message.error(msg);
      return false;
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <Typography.Title level={3} style={{ marginBottom: 6 }}>
        新增线路向导
      </Typography.Title>
      <Text type="secondary">
        按步骤执行并确认，最后通过外部系统接口验收。当前阶段以“可跑通流程”为主。
      </Text>

      <Card style={{ marginTop: 16, marginBottom: 16 }}>
        <Steps
          current={activeStep}
          size="small"
          items={[
            { title: '域名准备', status: stepDone[0] ? 'finish' : activeStep === 0 ? 'process' : 'wait' },
            { title: '线路域名', status: stepDone[1] ? 'finish' : activeStep === 1 ? 'process' : 'wait' },
            { title: 'Ingress/TLS', status: stepDone[2] ? 'finish' : activeStep === 2 ? 'process' : 'wait' },
            { title: '平台登记', status: stepDone[3] ? 'finish' : activeStep === 3 ? 'process' : 'wait' },
            { title: 'DCDN/HTTPS', status: stepDone[4] ? 'finish' : activeStep === 4 ? 'process' : 'wait' },
            { title: '连通性验证', status: stepDone[5] ? 'finish' : activeStep === 5 ? 'process' : 'wait' },
            { title: '外部API验收', status: stepDone[6] ? 'finish' : activeStep === 6 ? 'process' : 'wait' },
          ]}
        />
      </Card>

      <Card title="步骤1：域名准备" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'tenant-help',
              label: '查看目标租户说明',
              children: <Alert type="info" showIcon message="先选择目标租户" description="步骤4 的 tenant_domain 写入会自动使用这里选择的租户 ID。" />,
            }]}
          />
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>目标租户（当前环境）</Text>
            <Select
              value={selectedTenantId}
              onChange={(value) => {
                setSelectedTenantId(value);
                setSuperAdminRegistered(false);
                setSuperAdminRegisterError(null);
                setSuperAdminRegisterResult(null);
                setSuperAdminPendingUpdate(false);
                setSuperAdminLinesOpen(false);
                setConnectivityChecked(false);
                setSqlConfirmed(false);
                setVerifyResult(null);
                setVerifyError(null);
              }}
              loading={tenantLoading}
              style={{ width: '100%' }}
              placeholder={tenantLoading ? '加载中...' : '请选择租户'}
              options={tenants.map((tenant) => ({
                value: tenant.id,
                label: `${tenant.id} - ${tenant.name}`,
              }))}
              notFoundContent={tenantLoading ? '加载中...' : '当前环境暂无租户'}
            />
            {tenantLoadError ? <Text type="danger">{tenantLoadError}</Text> : null}
          </Space>
          <Paragraph style={{ marginBottom: 0 }}>
            购买地址：
            <Link href="https://www.aimi.com.cn/" target="_blank" rel="noreferrer">
              https://www.aimi.com.cn/
            </Link>
          </Paragraph>
          <Paragraph style={{ marginBottom: 0 }}>
            SSL证书购买地址：
            <Link href="https://www.aimi.com.cn/ssl-buy?certId=24" target="_blank" rel="noreferrer">
              https://www.aimi.com.cn/ssl-buy?certId=24
            </Link>
          </Paragraph>
          <Input
            value={rootDomainInput}
            onChange={(e) => {
              const value = e.target.value.trim().toLowerCase();
              setRootDomainInput(value);
              const normalized = normalizeDomain(value);
              if (DOMAIN_REGEX.test(normalized)) {
                if (normalized !== confirmedRootDomain) {
                  resetFromStep2();
                }
                setConfirmedRootDomain(normalized);
              } else {
                setConfirmedRootDomain('');
              }
            }}
            placeholder="例如 sample.com"
          />
          {confirmedRootDomain ? <Tag color="blue">当前一级域名：{confirmedRootDomain}</Tag> : null}
        </Space>
      </Card>

      <Card title="步骤2：线路域名" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text>推荐命令：<Text code>openssl rand -hex 16</Text></Text>
          <Text type="secondary">系统将生成随机前缀（12~20位十六进制）并与步骤1域名拼接，示例：f0c15ebd6dc50f8.sample.com</Text>
          <Space>
            <Button onClick={handleGenerateSubdomain} disabled={!confirmedRootDomain}>
              生成子域名
            </Button>
          </Space>
          <Input
            value={generatedSubdomain}
            onChange={(e) => {
              const value = e.target.value.trim().toLowerCase();
              setGeneratedSubdomain(value);
              const candidate = normalizeDomain(value);
              if (SUBDOMAIN_REGEX.test(candidate)) {
                if (candidate !== confirmedSubdomain) {
                  resetFromStep3();
                }
                setResolvedIngressSource(null);
                setSourceIngressError(null);
                setSelectedSourceIngressKey('');
                setNewIngressNameInput(generateDefaultIngressName(candidate));
                setConfirmedSubdomain(candidate);
              } else {
                setConfirmedSubdomain('');
              }
            }}
            placeholder="生成结果"
            disabled={!confirmedRootDomain}
          />
          {confirmedSubdomain ? <Tag color="green">当前线路域名：{confirmedSubdomain}</Tag> : null}
        </Space>
      </Card>

      <Card title="步骤3：Ingress/TLS 应用" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'ingress-clone-help',
              label: '查看 Ingress 克隆说明',
              children: <Alert type="info" showIcon message="手动选择 source ingress，先预览 YAML，再确认创建" description="目标 host 固定使用步骤2生成的新子域名。推荐使用“新 TLS Secret”模式，先生成 Ingress YAML 预览，确认无误后再执行创建。" />,
            }]}
          />
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>目标环境：<Text code>{currentEnvironment?.id || '-'}</Text></Text>
            <Text>目标 host（来自步骤2）：<Text code>{confirmedSubdomain || '(待生成)'}</Text></Text>
            <Text>source ingress：<Text code>{selectedSourceIngressKey || '(未选择)'}</Text></Text>
          </Space>
          <Space wrap>
            <Button
              loading={sourceIngressLoading}
              onClick={handleLoadSourceIngressCandidates}
              disabled={!confirmedSubdomain}
            >
              加载 source ingress 候选
            </Button>
            <Select
              style={{ width: 520 }}
              placeholder="请选择用于克隆的 source ingress"
              value={selectedSourceIngressKey || undefined}
              onChange={(value) => {
                setSelectedSourceIngressKey(value);
                setIngressPreviewResult(null);
                setIngressPreviewError(null);
              }}
              disabled={!resolvedIngressSource?.candidates?.length}
              options={(resolvedIngressSource?.candidates || []).map((item) => ({
                value: `${item.namespace}/${item.name}`,
                label: `${item.namespace}/${item.name}${item.ruleHosts?.length ? ` · ${item.ruleHosts.join(', ')}` : ''}`,
              }))}
              showSearch
              optionFilterProp="label"
            />
            {resolvedIngressSource?.matchedBy ? <Tag color="blue">候选来源：{resolvedIngressSource.matchedBy}</Tag> : null}
          </Space>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>新 ingress 名称：</Text>
            <Input
              style={{ maxWidth: 520 }}
              value={newIngressNameInput}
              onChange={(e) => {
                setNewIngressNameInput(e.target.value.trim().toLowerCase());
                setIngressPreviewResult(null);
              }}
              placeholder="例如 nginx-web-app-l01-test-2605040650"
              disabled={!confirmedSubdomain}
            />
            <Text type="secondary">默认规则：nginx-web-app-{'{host前缀}'}-{'{YYMMDDHHmm}'}，可按实际命名规范手动修改。</Text>
          </Space>

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text>TLS Secret 策略：<Tag color="green">为新域名生成新 TLS Secret（推荐）</Tag></Text>
            <Text type="secondary">预览会默认使用新子域名前缀拼接 <Text code>-tls</Text>；如需覆盖，可在预览输出下方手动输入 TLS Secret 名称后再确认创建。</Text>
          </Space>

          {sourceIngressError ? <Alert type="error" showIcon message={sourceIngressError} /> : null}
          {ingressPreviewError ? <Alert type="error" showIcon message={ingressPreviewError} /> : null}

          <Space>
            <Button
              loading={ingressPreviewLoading}
              onClick={handlePreviewCloneIngress}
              disabled={!confirmedSubdomain || !selectedSourceIngressKey || !newIngressNameInput.trim()}
            >
              生成 Ingress YAML 预览
            </Button>
            <Button
              type="primary"
              loading={ingressApplying}
              onClick={handleCloneIngressApply}
              disabled={!ingressPreviewResult || ingressPreviewLoading}
            >
              用户确认后执行创建
            </Button>
            {ingressApplied ? <Tag color="green">已执行</Tag> : null}
          </Space>

          {ingressPreviewResult ? (
            <Alert
              type="info"
              showIcon
              message="Ingress YAML 预览"
              description={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Text>新 Ingress：<Text code>{ingressPreviewResult.newIngressName}</Text></Text>
                  <Text>Namespace：<Text code>{ingressPreviewResult.namespace}</Text></Text>
                  <Text>Host：<Text code>{ingressPreviewResult.host}</Text></Text>
                  <Text>TLS Secret：<Text code>{tlsSecretNameInput || (ingressPreviewResult.tlsSecretNames || []).join(', ') || '(待填写)'}</Text></Text>
                  <Input
                    style={{ maxWidth: 520 }}
                    value={tlsSecretNameInput}
                    onChange={(e) => {
                      setTlsSecretNameInput(e.target.value.trim().toLowerCase());
                      setIngressApplied(false);
                    }}
                    placeholder="例如 mgggf12be7574100-tls"
                  />
                  <Text type="secondary">如需覆盖预览中的 TLS Secret，可在这里修改；确认创建时会以此名称为准。</Text>
                  {ingressPreviewResult.yaml ? (
                    <Collapse
                      ghost
                      size="small"
                      items={[{
                        key: 'ingress-yaml-detail',
                        label: '展开查看完整 YAML',
                        children: (
                          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#fafafa', padding: 12, borderRadius: 6, border: '1px solid #f0f0f0' }}>
                            {ingressPreviewResult.yaml}
                          </pre>
                        ),
                      }]}
                    />
                  ) : null}
                </Space>
              }
            />
          ) : null}

          {ingressApplyError ? <Alert type="error" showIcon message={ingressApplyError} /> : null}
          {ingressApplyResult ? (
            <Alert
              type="success"
              showIcon
              message="Ingress 克隆应用成功"
              description={
                <Space direction="vertical" size={2}>
                  <Text>新 Ingress：<Text code>{ingressApplyResult.newIngressName}</Text></Text>
                  <Text>Namespace：<Text code>{ingressApplyResult.namespace}</Text></Text>
                  <Text>Host：<Text code>{ingressApplyResult.host}</Text></Text>
                </Space>
              }
            />
          ) : null}
        </Space>
      </Card>

      <Card title="步骤4：DCDN/HTTPS 配置" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">
            使用步骤2确认的线路域名：{confirmedSubdomain || '(待确认)'}
          </Text>
          <Input
            value={originDomainInput}
            onChange={(e) => {
              setOriginDomainInput(e.target.value);
              resetStep3Runtime();
            }}
            placeholder="输入源站域名（例如 origin.sample.com）"
            disabled={!confirmedSubdomain}
          />
          <Space>
            <Button onClick={handleLoadIngressOriginCandidates} disabled={!confirmedSubdomain} loading={ingressCandidatesLoading}>
              查看 Ingress 候选源站
            </Button>
            <Text type="secondary">可通过当前环境 kubeContext 拉取 ingress（关键字：nginx-web-app）并选择源站。</Text>
          </Space>
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'dcdn-order',
              label: '查看操作顺序 / 风险提示',
              children: <Alert type="info" showIcon message="操作顺序" description="先输入源站域名并点击“1) 创建/复用 DCDN 域名”，成功后配置 HTTPS/WebSocket/WAF，再配置缓存，最后同步 Route53 CNAME。" />,
            }]}
          />
          <Space>
            <Button
              type="primary"
              loading={dcdnProvisioning}
              onClick={handleProvisionDcdn}
              disabled={!confirmedSubdomain}
            >
              1) 创建/复用 DCDN 域名
            </Button>
            <Button
              loading={dcdnRefreshing}
              onClick={handleRefreshDcdnStatus}
              disabled={!confirmedSubdomain}
            >
              刷新域名状态
            </Button>
            <Tag color={dcdnRefreshing ? 'processing' : dcdnLastRefreshAt ? 'green' : 'default'}>
              {dcdnRefreshing
                ? '刷新中...'
                : dcdnLastRefreshAt
                  ? `最近刷新 ${new Date(dcdnLastRefreshAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                  : '未刷新'}
            </Tag>
            <Tag color="blue">类型: 源站域名</Tag>
            <Tag color="blue">端口: 443</Tag>
            <Tag color="blue">优先级: 主</Tag>
            <Tag color="blue">权重: 10</Tag>
          </Space>
          {dcdnAutoError ? <Alert type="error" showIcon message={dcdnAutoError} /> : null}
          {dcdnAutoResult ? (
            <Alert
              type={dcdnAutoResult.created ? 'success' : 'info'}
              showIcon
              message={dcdnAutoResult.created ? 'DCDN 自动创建成功' : 'DCDN 域名已存在，已复用'}
              description={
                <Space direction="vertical" size={2}>
                  <Text>域名：{dcdnAutoResult.domainName}</Text>
                  <Text>源站：{dcdnAutoResult.originDomain}</Text>
                  <Text>
                    域名状态：
                    {toDomainStatusTag(dcdnAutoResult.domainStatus)}
                  </Text>
                  <Text>
                    CNAME检测：
                    {toCnameStatusTag(dcdnAutoResult.cnameCheckStatus)}
                  </Text>
                  <Text>CNAME：{dcdnAutoResult.cname || '(暂未返回，请稍后刷新或手工查询)'}</Text>
                  {dcdnAutoResult.cnameCheckErrMsg ? (
                    <Text type="warning">CNAME说明：{dcdnAutoResult.cnameCheckErrMsg}</Text>
                  ) : null}
                  <Text>加速区域：{dcdnAutoResult.scope || '-'}</Text>
                  <Text>HTTPS：{toStatusText(dcdnAutoResult.httpsEnabled)}</Text>
                  <Text>WebSocket：{toStatusText(dcdnAutoResult.websocketEnabled)}</Text>
                  <Text>WAF：{toStatusText(dcdnAutoResult.wafEnabled)}</Text>
                  <Text>缓存 /img：{toStatusText(dcdnAutoResult.cacheRuleConfigured)}</Text>
                  <Text>证书名称：{dcdnAutoResult.certName || '-'}</Text>
                  <Text>证书地域：{dcdnAutoResult.certRegion || '-'}</Text>
                  <Text>证书状态：{toCertStatusText(dcdnAutoResult.certStatus)}</Text>
                  <Text>证书绑定域名：{dcdnAutoResult.certDomainName || '-'}</Text>
                  <Text>证书到期：{dcdnAutoResult.certExpireTime || '-'}</Text>
                  <Text>创建时间：{toDisplayTime(dcdnAutoResult.createdAt)}</Text>
                  <Text>更新时间：{toDisplayTime(dcdnAutoResult.updatedAt)}</Text>
                  <Text>资源组：{dcdnAutoResult.resourceGroupId || '-'}</Text>
                  <Text>
                    最近刷新（本地）：
                    {toDisplayTime(dcdnLastRefreshAt)}
                  </Text>
                  <Text>
                    标签：
                    {dcdnAutoResult.tags && dcdnAutoResult.tags.length > 0
                      ? dcdnAutoResult.tags.map((tag) => `${tag.key}:${tag.value}`).join(', ')
                      : '-'}
                  </Text>
                  {dcdnAutoResult.verifyRequired ? (
                    <Text type="warning">可能仍需人工做域名校验/等待配置生效。</Text>
                  ) : null}
                  {(dcdnAutoResult.warnings || []).map((item, index) => (
                    <Text key={`dcdn-warning-${index}`} type="warning">
                      {item}
                    </Text>
                  ))}
                </Space>
              }
            />
          ) : null}

          <Divider style={{ margin: '8px 0' }} />
          <Text strong>2) 配置 HTTPS/WebSocket/WAF/缓存</Text>
          <Text type="secondary">
            推荐证书来源：使用步骤3 Ingress/TLS 生成的 K8s TLS Secret，并自动上传到 CAS 后绑定 DCDN。CAS 复用/手动上传保留为高级备用。
          </Text>
          <Radio.Group
            value={certSource}
            onChange={(e) => {
              setCertSource(e.target.value);
              setSecurityApplyError(null);
              setSecurityApplyResult(null);
            }}
            optionType="button"
            buttonStyle="solid"
            disabled={!dcdnAutoResult?.domainName}
          >
            <Radio.Button value="k8s-secret">K8s TLS Secret（推荐）</Radio.Button>
            <Radio.Button value="cas">CAS 高级</Radio.Button>
            <Radio.Button value="upload">直传备用</Radio.Button>
          </Radio.Group>

          {certSource === 'k8s-secret' ? (
            <Alert
              type="info"
              showIcon
              message="将同步 K8s TLS Secret 到 DCDN"
              description={
                <Space direction="vertical" size={2}>
                  <Text>TLS Secret：<Text code>{dcdnTlsSecretName || '(待生成)'}</Text></Text>
                  <Text>Namespace：<Text code>default</Text></Text>
                  <Text type="secondary">点击应用时，后端会读取该 Secret 的 tls.crt/tls.key，上传到 CAS，并绑定到当前 DCDN 域名。</Text>
                </Space>
              }
            />
          ) : null}

          {certSource === 'cas' ? (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Radio.Group
                value={casCertMode}
                onChange={(e) => {
                  setCasCertMode(e.target.value);
                  setSecurityApplyError(null);
                  setSecurityApplyResult(null);
                }}
                optionType="button"
                buttonStyle="solid"
                disabled={!dcdnAutoResult?.domainName}
              >
                <Radio.Button value="reuse">复用已有 CAS 证书</Radio.Button>
                <Radio.Button value="upload">上传新证书到 CAS</Radio.Button>
              </Radio.Group>
              {casCertMode === 'reuse' ? (
                <>
                  <Space>
                    <Button
                      loading={casCertLoading}
                      onClick={handleLoadCasCertificates}
                      disabled={!dcdnAutoResult?.domainName || !confirmedRootDomain || !confirmedSubdomain}
                    >
                      加载 {confirmedRootDomain || '{一级域名}'} 可复用证书
                    </Button>
                    <Text type="secondary">
                      当前已加载：{casCertOptions.length} 个
                    </Text>
                  </Space>
                  <Select
                    showSearch
                    value={selectedCasCertId}
                    onChange={(value) => setSelectedCasCertId(value)}
                    placeholder="请选择可复用的 CAS 证书"
                    style={{ width: '100%' }}
                    disabled={!dcdnAutoResult?.domainName}
                    options={casCertOptions.map((item) => ({
                      label: `${item.certName} | 匹配=${item.matchedDomains.join(', ')} | 到期=${item.endDate || '-'}`,
                      value: item.certificateId,
                    }))}
                    filterOption={(input, option) =>
                      String(option?.label || '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                  {selectedCasCert ? (
                    <Alert
                      type="info"
                      showIcon
                      message="已选 CAS 证书"
                      description={
                        <Space direction="vertical" size={2}>
                          <Text>证书ID：{selectedCasCert.certificateId}</Text>
                          <Text>证书名：{selectedCasCert.certName}</Text>
                          <Text>匹配域名：{selectedCasCert.matchedDomains.join(', ') || '-'}</Text>
                          <Text>匹配类型：{selectedCasCert.wildcardMatched ? '泛域名匹配' : '精确域名匹配'}</Text>
                          <Text>到期时间：{selectedCasCert.endDate || '-'}</Text>
                        </Space>
                      }
                    />
                  ) : null}
                </>
              ) : null}
            </Space>
          ) : null}

          {showUploadCertificateInputs ? (
            <>
              <Space wrap>
                <Button onClick={() => document.getElementById('dcdn-cert-file')?.click()} disabled={!dcdnAutoResult?.domainName}>
                  读取 cert.crt
                </Button>
                <Button onClick={() => document.getElementById('dcdn-key-file')?.click()} disabled={!dcdnAutoResult?.domainName}>
                  读取 privkey.key
                </Button>
              </Space>
              <Input.TextArea
                value={sslPubInput}
                onChange={(e) => setSslPubInput(e.target.value)}
                placeholder="粘贴 cert.crt 内容（BEGIN CERTIFICATE ...）"
                autoSize={{ minRows: 3, maxRows: 8 }}
                disabled={!dcdnAutoResult?.domainName}
              />
              <Input.TextArea
                value={sslPriInput}
                onChange={(e) => setSslPriInput(e.target.value)}
                placeholder="粘贴 privkey.key 内容（BEGIN PRIVATE KEY ...）"
                autoSize={{ minRows: 3, maxRows: 8 }}
                disabled={!dcdnAutoResult?.domainName}
              />
            </>
          ) : null}

          <input
            id="dcdn-cert-file"
            type="file"
            accept=".crt,.pem,.cer,.txt"
            style={{ display: 'none' }}
            onChange={(e) => handleFileImport(e, 'sslPub')}
          />
          <input
            id="dcdn-key-file"
            type="file"
            accept=".key,.pem,.txt"
            style={{ display: 'none' }}
            onChange={(e) => handleFileImport(e, 'sslPri')}
          />
          <Input
            value={certNameInput}
            onChange={(e) => setCertNameInput(e.target.value)}
            placeholder={certSource === 'cas' && casCertMode === 'reuse' ? '可选：DCDN 侧绑定显示名称' : '证书名称（可选，默认 {子域名}-cert）'}
            disabled={!dcdnAutoResult?.domainName}
          />
          <Space>
            <Text>自动开启 WebSocket</Text>
            <Switch checked={enableWebsocket} onChange={setEnableWebsocket} disabled={!dcdnAutoResult?.domainName} />
            <Text>自动接入 WAF</Text>
            <Switch checked={enableWaf} onChange={setEnableWaf} disabled={!dcdnAutoResult?.domainName} />
          </Space>
          <Text strong>缓存配置</Text>
          <Space align="center">
            <Text>配置缓存</Text>
            <Switch checked={enableCache} onChange={setEnableCache} disabled={!dcdnAutoResult?.domainName} />
            <Tag color={enableCache ? 'green' : 'default'}>{enableCache ? '默认开启' : '已关闭'}</Tag>
          </Space>
          <Alert
            type="info"
            showIcon
            message="默认缓存规则：目录 /img 缓存 1 年"
            description={
              <Space direction="vertical" size={2}>
                <Text>类型：<Text code>目录</Text></Text>
                <Text>内容：<Text code>/img</Text></Text>
                <Text>过期时间：<Text code>1 年</Text> / <Text code>31536000 秒</Text></Text>
                <Text>规则条件：<Text code>不使用</Text></Text>
                <Collapse
                  ghost
                  size="small"
                  items={[{
                    key: 'dcdn-cache-detail',
                    label: '展开查看完整缓存配置',
                    children: (
                      <Space direction="vertical" size={2}>
                        <Text>有限遵循源站缓存策略：关闭</Text>
                        <Text>忽略源站不缓存标头：关闭</Text>
                        <Text>客户端跟随 DCDN 缓存策略：关闭</Text>
                        <Text>强制内容重新验证：关闭（等同于缓存策略 no-store）</Text>
                        <Text>权重：1</Text>
                        <Text>API Function：<Text code>path_based_ttl_set</Text></Text>
                      </Space>
                    ),
                  }]}
                />
              </Space>
            }
          />
          <Button
            type="primary"
            loading={dcdnSecurityApplying}
            onClick={handleApplyDcdnSecurity}
            disabled={!dcdnAutoResult?.domainName}
          >
            应用 HTTPS / WebSocket / WAF / 缓存配置
          </Button>
          {securityApplyError ? <Alert type="error" showIcon message={securityApplyError} /> : null}
          {securityApplyResult ? (
            <Alert
              type={securityApplyResult.errors.length > 0 ? 'warning' : 'success'}
              showIcon
              message={securityApplyResult.message}
              description={
                <Space direction="vertical" size={2}>
                  <Text>证书名称：{securityApplyResult.certName}</Text>
                  <Text>证书来源：{securityApplyResult.certSource === 'k8s-secret' ? 'K8s TLS Secret → CAS' : securityApplyResult.certSource === 'upload' ? '直传（备用）' : 'CAS（云盾SSL证书中心）'}</Text>
                  <Text>CAS证书ID：{securityApplyResult.certId || '-'}</Text>
                  <Text>HTTPS 配置：{securityApplyResult.httpsConfigured ? '成功' : '失败'}</Text>
                  <Text>WebSocket 配置：{securityApplyResult.websocketConfigured ? '成功' : '失败'}</Text>
                  <Text>WAF 配置：{securityApplyResult.wafConfigured ? '成功' : '失败'}</Text>
                  <Text>缓存配置：{enableCache ? (securityApplyResult.cacheConfigured ? '成功' : '失败') : '已关闭'}</Text>
                  {(securityApplyResult.warnings || []).map((item, index) => (
                    <Text key={`security-warning-${index}`} type="warning">
                      {item}
                    </Text>
                  ))}
                  {(securityApplyResult.errors || []).map((item, index) => (
                    <Text key={`security-error-${index}`} type="danger">
                      {item}
                    </Text>
                  ))}
                </Space>
              }
            />
          ) : null}

          <Divider style={{ margin: '8px 0' }} />
          <Text strong>3) 同步 AWS Route53 CNAME</Text>
          <Alert
            type="info"
            showIcon
            message="将 DCDN CNAME 写入步骤1一级域名对应的 Route53 Hosted Zone"
            description={
              <Space direction="vertical" size={2}>
                <Text>记录名称：<Text code>{confirmedSubdomain || '(待生成)'}</Text></Text>
                <Text>记录类型：<Text code>CNAME</Text></Text>
                <Text>记录值：<Text code>{dcdnCname || dcdnAutoResult?.cname || '(等待 DCDN 返回 CNAME)'}</Text></Text>
                <Text>查找 Zone：<Text code>{confirmedRootDomain || '(步骤1一级域名)'}</Text></Text>
              </Space>
            }
          />
          <Space>
            <Button
              loading={route53Previewing}
              onClick={handlePreviewRoute53Cname}
              disabled={route53Syncing || !confirmedSubdomain || !(dcdnCname || dcdnAutoResult?.cname)}
            >
              预览 Route53 CNAME
            </Button>
            <Button
              type="primary"
              loading={route53Syncing}
              onClick={handleSyncRoute53Cname}
              disabled={route53Previewing || !confirmedSubdomain || !(dcdnCname || dcdnAutoResult?.cname)}
            >
              同步 Route53 CNAME
            </Button>
          </Space>
          {route53SyncError ? <Alert type="error" showIcon message={route53SyncError} /> : null}
          {route53PreviewResult ? (
            <Alert
              type={route53PreviewResult.safeToApply ? (route53PreviewResult.alreadySynced ? 'success' : 'info') : 'warning'}
              showIcon
              message={route53PreviewResult.message}
              description={
                <Space direction="vertical" size={2}>
                  <Text>Hosted Zone：<Text code>{route53PreviewResult.hostedZoneName}</Text> / <Text code>{route53PreviewResult.hostedZoneId}</Text></Text>
                  <Text>记录：<Text code>{route53PreviewResult.recordName}</Text> CNAME <Text code>{route53PreviewResult.recordValue}</Text></Text>
                  <Text>动作：<Tag color={route53PreviewResult.action === 'none' ? 'green' : 'blue'}>{route53PreviewResult.action}</Tag></Text>
                  {route53PreviewResult.existing ? (
                    <Text>已有 CNAME：<Text code>{route53PreviewResult.existing.values.join(', ')}</Text></Text>
                  ) : null}
                  {route53PreviewResult.conflicts && route53PreviewResult.conflicts.length > 0 ? (
                    <Text type="danger">冲突记录：{route53PreviewResult.conflicts.map((item) => item.type).join(', ')}</Text>
                  ) : null}
                  {route53SyncResult?.changeId ? (
                    <Text>Change：<Text code>{route53SyncResult.changeId}</Text> / {route53SyncResult.changeStatus || '-'}</Text>
                  ) : null}
                </Space>
              }
            />
          ) : null}


          <Input
            value={dcdnCname}
            onChange={(e) => {
              setDcdnCname(e.target.value);
              setDcdnConfirmed(false);
            }}
            placeholder="DCDN 返回的 CNAME（自动获取失败时可手工填写）"
            disabled={!confirmedSubdomain}
          />
          <Space>
            <Button type="primary" onClick={handleConfirmDcdn} disabled={!confirmedSubdomain}>
              确认 DCDN 配置
            </Button>
            {dcdnConfirmed ? <Tag color="green">已确认</Tag> : null}
          </Space>
        </Space>
      </Card>

      <Card title="步骤5：平台登记" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">同一个环境仅有一个超级后台，与租户无关。</Text>
          <Text type="secondary">登记动作会通过当前环境 kubeContext 代理调用集群内超级后台接口。</Text>
          <Text strong>1) tenant_domain 自动写入</Text>
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'tenant-domain-help',
              label: '查看 tenant_domain 写入说明',
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Text type="secondary">
                    tenant_id 自动取自步骤1选择的目标租户；domian 自动取自步骤2线路域名。推荐使用自动写入 tenant_domain。
                  </Text>
                  <Alert type="warning" showIcon message="平台登记前先写入 tenant_domain" description="当前只要求已选择租户并生成可用线路域名；建议在步骤4完成 DCDN/HTTPS/Route53 后执行。" />
                </Space>
              ),
            }]}
          />
          <Text>
            目标租户：
            {selectedTenant ? (
              <Text code>
                {selectedTenant.id} - {selectedTenant.name}
              </Text>
            ) : (
              <Text type="warning">未选择（请回到步骤1选择）</Text>
            )}
          </Text>
          <Collapse
            size="small"
            items={[{
              key: 'tenant-domain-sql',
              label: '展开查看备用 SQL',
              children: <Paragraph code style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{insertSql}</Paragraph>,
            }]}
          />
          <Space wrap>
            <Button
              type="primary"
              loading={tenantDomainApplying}
              onClick={handleApplyTenantDomain}
              disabled={!dcdnConfirmed || !selectedTenantId || !confirmedSubdomain}
            >
              自动写入 tenant_domain
            </Button>
            {tenantDomainApplyResult ? <Tag color="green">已写入</Tag> : null}
          </Space>
          {tenantDomainApplyError ? <Alert type="error" showIcon message={tenantDomainApplyError} /> : null}
          {tenantDomainApplyResult ? (
            <Alert
              type="success"
              showIcon
              message={tenantDomainApplyResult.action === 'created' ? 'tenant_domain 写入成功' : 'tenant_domain 已存在，未重复写入'}
              description={
                <Space direction="vertical" size={2}>
                  <Text>Action：<Tag color={tenantDomainApplyResult.action === 'created' ? 'green' : 'blue'}>{tenantDomainApplyResult.action}</Tag></Text>
                  <Text>ID：<Text code>{tenantDomainApplyResult.id || '-'}</Text></Text>
                  <Text>Tenant ID：<Text code>{tenantDomainApplyResult.tenantId}</Text></Text>
                  <Text>Domian：<Text code>{tenantDomainApplyResult.domain}</Text></Text>
                  <Text>Status：<Text code>{tenantDomainApplyResult.status}</Text></Text>
                </Space>
              }
            />
          ) : null}


          <Divider style={{ margin: '4px 0' }} />
          <Text strong>2) 在超级后台登记新线路</Text>
          <Text>
            当前环境：<Text code>{currentEnvironment?.name || currentEnvironment?.id || '-'}</Text>
          </Text>
          <Text>
            大管理端地址：
            {superAdminUrl ? (
              <Link href={superAdminUrl} target="_blank" rel="noreferrer">
                {superAdminUrl}
              </Link>
            ) : (
              <Text type="warning">
                {superAdminLoading ? '加载中...' : '未配置，请在“环境管理”中设置大管理端地址'}
              </Text>
            )}
          </Text>
          <Input value={superAdminLineUrl} placeholder="lineUrl（自动生成）" disabled />
          <Input value={superAdminOtcUrl} placeholder="otcUrl（自动生成）" disabled />
          <Input
            value={superAdminLineZh}
            onChange={(e) => {
              setSuperAdminLineZh(e.target.value);
              setSuperAdminRegistered(false);
              setSuperAdminPendingUpdate(false);
              setSuperAdminRegisterResult(null);
            }}
            placeholder="线路中文名（zh），例如：线路-l01"
            disabled={!dcdnConfirmed}
          />
          <Input
            value={superAdminLineEn}
            onChange={(e) => {
              setSuperAdminLineEn(e.target.value);
              setSuperAdminRegistered(false);
              setSuperAdminPendingUpdate(false);
              setSuperAdminRegisterResult(null);
            }}
            placeholder="线路英文名（en），例如：l01"
            disabled={!dcdnConfirmed}
          />
          <Alert type="info" showIcon message="平台登记默认停用" description="新线路先以停用状态登记；步骤6 连通性验证通过后再启用。" />
          <Space>
            <Text>状态（status）</Text>
            <Switch
              checked={superAdminLineStatus}
              checkedChildren="启用"
              unCheckedChildren="停用"
              onChange={(checked) => {
                setSuperAdminLineStatus(checked);
                setSuperAdminRegistered(false);
                setSuperAdminPendingUpdate(false);
                setSuperAdminRegisterResult(null);
              }}
              disabled={!dcdnConfirmed}
            />
          </Space>
          <Space>
            <Button
              type="primary"
              loading={superAdminRegistering}
              onClick={handleConfirmSuperAdminRegistration}
              disabled={!dcdnConfirmed || !selectedTenantId || !confirmedSubdomain}
            >
              确认并自动登记新线路（默认停用）
            </Button>
            <Button
              onClick={() => {
                if (!selectedTenantId) {
                  message.warning('请先在步骤1选择目标租户');
                  return;
                }
                setSuperAdminLinesReloadKey((prev) => prev + 1);
                setSuperAdminLinesOpen(true);
              }}
              disabled={!selectedTenantId}
            >
              查看当前租户全部线路
            </Button>
            {superAdminRegistered ? <Tag color="green">已登记</Tag> : null}
          </Space>
          {superAdminRegisterError ? <Alert type="error" showIcon message={superAdminRegisterError} /> : null}
          {superAdminRegisterResult ? (
            <Alert
              type={superAdminRegisterResult.action === 'conflict' ? 'warning' : 'success'}
              showIcon
              message={superAdminRegisterResult.message}
              description={
                superAdminRegisterResult.action === 'conflict' && superAdminRegisterResult.differences?.length ? (
                  <Space direction="vertical" size={4}>
                    {superAdminRegisterResult.differences.map((item) => (
                      <Text key={`line-diff-${item.field}`}>
                        {item.field}: 现有=<Text code>{String(item.existing)}</Text>，目标=<Text code>{String(item.incoming)}</Text>
                      </Text>
                    ))}
                    <Space>
                      <Button
                        size="small"
                        type="primary"
                        loading={superAdminRegistering}
                        onClick={handleUpdateSuperAdminRegistration}
                        disabled={!superAdminPendingUpdate}
                      >
                        更新已有线路
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setSuperAdminPendingUpdate(false);
                          setSuperAdminRegisterResult(null);
                        }}
                      >
                        取消
                      </Button>
                    </Space>
                  </Space>
                ) : null
              }
            />
          ) : null}

        </Space>
      </Card>

      <Card title="步骤6：连通性验证" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">点击后由后台请求检查地址；只有返回有效 data 数据时，才会继续启用平台线路。</Text>
          <Text>检查地址：<Text code>{connectivityUrl || 'https://{步骤2子域名}/pro/p/symbol/list'}</Text></Text>
          <Space>
            <Button
              type="primary"
              loading={superAdminActivating}
              onClick={handleActivateSuperAdminLine}
              disabled={superAdminLineStatus || !selectedTenantId || !confirmedSubdomain}
            >
              连通性确认后启用平台线路
            </Button>
            {superAdminLineStatus ? <Tag color="green">平台线路已启用</Tag> : <Tag color="orange">平台线路停用中</Tag>}
          </Space>
        </Space>
      </Card>

      <Card title="步骤7：外部API验收">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'external-verify-help',
              label: '查看外部 API 验收说明',
              children: <Alert type="info" showIcon message="调用外部系统接口进行验收" description="接口地址：http://172.31.29.3:3000/api/lines（不是当前系统接口）" />,
            }]}
          />
          <Space>
            <Button onClick={handleOpenProbeDetail}>
              打开外部探测详情
            </Button>
            <Button type="primary" loading={verifying} onClick={handleVerifyExternal} disabled={!confirmedSubdomain}>
              调用 /api/lines 验收
            </Button>
            {verifyResult?.exists ? <Tag color="green">验收通过</Tag> : null}
          </Space>
          {verifyError ? <Alert type="error" showIcon message={verifyError} /> : null}
          {verifyResult ? (
            <>
              <Alert
                type={verifyResult.exists ? 'success' : 'warning'}
                showIcon
                message={verifyResult.exists ? '在返回结果中找到线路子域名' : '未在返回结果中找到线路子域名'}
                description={
                  <Space direction="vertical" size={4}>
                    <Text>目标：{verifyResult.targetHost}</Text>
                    <Text>源接口：{verifyResult.sourceApi}</Text>
                    <Text>检查时间：{new Date(verifyResult.checkedAt).toLocaleString('zh-CN', { hour12: false })}</Text>
                  </Space>
                }
              />
            </>
          ) : null}
        </Space>
      </Card>

      <Modal
        title="Ingress 候选源站"
        open={ingressCandidatesOpen}
        onCancel={() => setIngressCandidatesOpen(false)}
        onOk={handleUseSelectedIngressOrigin}
        okText="使用所选源站"
        cancelText="取消"
        width={1080}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {ingressCandidatesError ? <Alert type="warning" showIcon message={ingressCandidatesError} /> : null}
          <Table<IngressOriginCandidate>
            rowKey="key"
            loading={ingressCandidatesLoading}
            dataSource={ingressCandidates}
            pagination={{ defaultPageSize: 10, pageSizeOptions: ['10', '20', '50'], showSizeChanger: true, showTotal: (total) => `共 ${total} 个候选源站` }}
            rowSelection={{
              type: 'radio',
              selectedRowKeys: selectedIngressCandidateKey ? [selectedIngressCandidateKey] : [],
              onChange: (selectedRowKeys) =>
                setSelectedIngressCandidateKey(selectedRowKeys[0] ? String(selectedRowKeys[0]) : null),
            }}
            columns={[
              { title: 'Namespace', dataIndex: 'namespace', width: 120 },
              { title: 'Ingress', dataIndex: 'ingressName', width: 200 },
              { title: '建议源站', dataIndex: 'originDomain', width: 320, ellipsis: true },
              {
                title: 'LB Address',
                dataIndex: 'lbAddresses',
                width: 220,
                render: (value: string[]) => (value && value.length ? value.join(', ') : '-'),
              },
              {
                title: 'Rules Host',
                dataIndex: 'ruleHosts',
                width: 220,
                render: (value: string[]) => (value && value.length ? value.join(', ') : '-'),
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                width: 180,
                render: (value: string | null | undefined) => (value ? toDisplayTime(value) : '-'),
              },
            ]}
            size="small"
            scroll={{ x: 1300 }}
          />
        </Space>
      </Modal>

      <Modal
        title={`租户线路列表（tenantId=${selectedTenantId || '-'}）`}
        open={superAdminLinesOpen}
        onCancel={() => setSuperAdminLinesOpen(false)}
        footer={null}
        width={980}
      >
        <TenantLinesTable
          tenantId={selectedTenantId}
          enabled={superAdminLinesOpen}
          reloadKey={superAdminLinesReloadKey}
          initialPageSize={20}
        />
      </Modal>
    </div>
  );
};

export default LineOnboardingPage;
