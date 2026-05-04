import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
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
  cloneIngressForLineOnboarding,
  provisionDcdnDomain,
  registerSuperAdminLine,
  verifyExternalLine,
} from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import TenantLinesTable from '../components/TenantLinesTable';

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
  certSource?: 'cas' | 'upload';
  certId?: number | null;
  httpsConfigured: boolean;
  websocketConfigured: boolean;
  wafConfigured: boolean;
  warnings: string[];
  errors: string[];
  status?: Partial<DcdnProvisionResult>;
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

type SuperAdminRegisterResult = {
  action: 'created' | 'unchanged' | 'conflict' | 'updated';
  message: string;
  differences?: Array<{ field: string; existing: any; incoming: any }>;
  canUpdate?: boolean;
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
  const [certSource, setCertSource] = useState<'cas' | 'upload'>('cas');
  const [casCertMode, setCasCertMode] = useState<'reuse' | 'upload'>('reuse');
  const [casCertLoading, setCasCertLoading] = useState(false);
  const [casCertOptions, setCasCertOptions] = useState<CasCertificateOption[]>([]);
  const [selectedCasCertId, setSelectedCasCertId] = useState<number | undefined>(undefined);
  const [enableWebsocket, setEnableWebsocket] = useState(true);
  const [enableWaf, setEnableWaf] = useState(true);
  const [securityApplyResult, setSecurityApplyResult] = useState<DcdnSecurityApplyResult | null>(null);
  const [securityApplyError, setSecurityApplyError] = useState<string | null>(null);

  const [ingressApplied, setIngressApplied] = useState(false);
  const [ingressApplying, setIngressApplying] = useState(false);
  const [ingressApplyError, setIngressApplyError] = useState<string | null>(null);
  const [ingressApplyResult, setIngressApplyResult] = useState<{ newIngressName: string; namespace: string; host: string } | null>(null);
  const [resolvedIngressSource, setResolvedIngressSource] = useState<ResolvedIngressSource | null>(null);
  const [sourceIngressLoading, setSourceIngressLoading] = useState(false);
  const [sourceIngressError, setSourceIngressError] = useState<string | null>(null);
  const [selectedSourceIngressKey, setSelectedSourceIngressKey] = useState<string>('');
  const [superAdminRegistered, setSuperAdminRegistered] = useState(false);
  const [superAdminLineZh, setSuperAdminLineZh] = useState('');
  const [superAdminLineEn, setSuperAdminLineEn] = useState('');
  const [superAdminLineStatus, setSuperAdminLineStatus] = useState(false);
  const [superAdminRegistering, setSuperAdminRegistering] = useState(false);
  const [superAdminRegisterError, setSuperAdminRegisterError] = useState<string | null>(null);
  const [superAdminRegisterResult, setSuperAdminRegisterResult] = useState<SuperAdminRegisterResult | null>(null);
  const [superAdminPendingUpdate, setSuperAdminPendingUpdate] = useState(false);
  const [superAdminLinesOpen, setSuperAdminLinesOpen] = useState(false);
  const [superAdminLinesReloadKey, setSuperAdminLinesReloadKey] = useState(0);
  const [connectivityChecked, setConnectivityChecked] = useState(false);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<number | undefined>(undefined);
  const [sqlConfirmed, setSqlConfirmed] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [superAdminUrl, setSuperAdminUrl] = useState<string>('');
  const [superAdminLoading, setSuperAdminLoading] = useState(false);

  const superAdminLineUrl = confirmedSubdomain ? `https://${confirmedSubdomain}` : '';
  const superAdminOtcUrl = confirmedSubdomain ? `https://${confirmedSubdomain}/otc` : '';
  const connectivityUrl = confirmedSubdomain ? `https://${confirmedSubdomain}/pro/p/symbol/list` : '';
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
    Boolean(confirmedRootDomain),
    Boolean(confirmedSubdomain),
    dcdnConfirmed,
    ingressApplied,
    connectivityChecked,
    sqlConfirmed,
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
    setCertSource('cas');
    setCasCertMode('reuse');
    setCasCertLoading(false);
    setCasCertOptions([]);
    setSelectedCasCertId(undefined);
    setEnableWebsocket(true);
    setEnableWaf(true);
    setSecurityApplyResult(null);
    setSecurityApplyError(null);
    setDcdnConfirmed(false);
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

  const handleConfirmRootDomain = () => {
    const normalized = normalizeDomain(rootDomainInput);
    if (!DOMAIN_REGEX.test(normalized)) {
      message.error('请输入合法一级域名，例如 sample.com');
      return;
    }
    if (normalized !== confirmedRootDomain) {
      resetFromStep2();
    }
    setRootDomainInput(normalized);
    setResolvedIngressSource(null);
    setSourceIngressError(null);
    setSelectedSourceIngressKey('');
    setConfirmedRootDomain(normalized);
    message.success(`已确认一级域名：${normalized}`);
  };

  const handleGenerateSubdomain = () => {
    if (!confirmedRootDomain) {
      message.warning('请先完成步骤1并确认一级域名');
      return;
    }
    const prefix = generateHex(randomPrefixLength());
    const subdomain = `${prefix}.${confirmedRootDomain}`;
    setGeneratedSubdomain(subdomain);
    if (subdomain !== confirmedSubdomain) {
      resetFromStep3();
    }
  };

  const handleConfirmSubdomain = () => {
    const candidate = normalizeDomain(generatedSubdomain);
    if (!SUBDOMAIN_REGEX.test(candidate)) {
      message.error('生成的线路子域名格式不合法');
      return;
    }
    if (candidate !== confirmedSubdomain) {
      resetFromStep3();
    }
    setGeneratedSubdomain(candidate);
    setResolvedIngressSource(null);
    setSourceIngressError(null);
    setSelectedSourceIngressKey('');
    setConfirmedSubdomain(candidate);
    message.success(`已确认线路子域名：${candidate}`);
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
    setDcdnAutoResult(null);
    setDcdnAutoError(null);
    setDcdnLastRefreshAt(null);
    setDcdnCname('');
    setSecurityApplyError(null);
    setSecurityApplyResult(null);
    setDcdnConfirmed(false);
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
      message.warning('请先完成步骤1并确认一级域名');
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
        casCertificateId: certSource === 'cas' && casCertMode === 'reuse' ? selectedCasCertId : undefined,
        casCertificateName:
          certSource === 'cas' && casCertMode === 'reuse' ? selectedCasCert?.certName : undefined,
        enableWebsocket,
        enableWaf,
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
        message.success('HTTPS/WebSocket/WAF 配置完成');
      }
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '应用 HTTPS/WebSocket/WAF 失败';
      setSecurityApplyError(msg);
      message.error(msg);
    } finally {
      setDcdnSecurityApplying(false);
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
      message.warning('请先完成步骤2并确认子域名');
      return;
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
      if (candidates.length === 0) {
        setSourceIngressError('未找到可用 source ingress 候选');
        return;
      }
      const first = `${candidates[0].namespace}/${candidates[0].name}`;
      setSelectedSourceIngressKey(first);
      message.success(`已加载 ${candidates.length} 个 source ingress 候选`);
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || error?.message || '加载 source ingress 候选失败';
      setSourceIngressError(msg);
      message.error(msg);
    } finally {
      setSourceIngressLoading(false);
    }
  };

  const handleCloneIngressApply = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2并确认子域名');
      return;
    }
    if (!selectedSourceIngressKey) {
      message.warning('请先加载并选择 source ingress');
      return;
    }

    setIngressApplying(true);
    setIngressApplyError(null);
    setIngressApplyResult(null);

    try {
      const [ns, name] = selectedSourceIngressKey.split('/');
      const sourceNamespace = ns || 'default';
      const sourceIngressName = name || '';
      if (!sourceIngressName) {
        throw new Error('source ingress 选择无效，请重新选择');
      }

      const resp = (await cloneIngressForLineOnboarding({
        environmentId: currentEnvironment?.id || '',
        namespace: sourceNamespace,
        sourceIngressName,
        newHost: confirmedSubdomain,
      })) as {
        success?: boolean;
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

  const doSuperAdminRegistration = async (mode: 'detect' | 'update' = 'detect') => {
    if (!ingressApplied) {
      message.warning('请先完成步骤4');
      return;
    }
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2并确认子域名');
      return;
    }
    if (!selectedTenantId) {
      message.warning('请先在步骤1选择目标租户');
      return;
    }
    if (!superAdminLineZh.trim() || !superAdminLineEn.trim()) {
      message.error('请先填写线路中文名和英文名');
      return;
    }

    setSuperAdminRegistering(true);
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
        status: superAdminLineStatus,
        tenantId: selectedTenantId,
        mode,
      })) as SuperAdminRegisterResult;

      setSuperAdminRegisterResult(result);
      if (result.action === 'conflict') {
        setSuperAdminPendingUpdate(Boolean(result.canUpdate));
        setSuperAdminRegistered(false);
        message.warning(result.message || '检测到已存在差异配置，请确认是否更新');
        return;
      }

      setSuperAdminPendingUpdate(false);
      setSuperAdminRegistered(true);
      setConnectivityChecked(false);
      setSqlConfirmed(false);
      setVerifyResult(null);
      setVerifyError(null);
      message.success(result.message || '超级后台登记成功');
    } catch (error: any) {
      const backendMsg = error?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || '超级后台登记失败';
      setSuperAdminRegisterError(msg);
      setSuperAdminRegistered(false);
      message.error(msg);
    } finally {
      setSuperAdminRegistering(false);
    }
  };

  const handleConfirmSuperAdminRegistration = () => {
    doSuperAdminRegistration('detect');
  };

  const handleUpdateSuperAdminRegistration = () => {
    doSuperAdminRegistration('update');
  };

  const handleConfirmConnectivity = () => {
    if (!ingressApplied) {
      message.warning('请先完成步骤4');
      return;
    }
    if (!superAdminRegistered) {
      message.warning('请先完成步骤5-1：在超级后台登记新线路');
      return;
    }
    setConnectivityChecked(true);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已确认联通性检查完成');
  };

  const handleConfirmSql = () => {
    if (!connectivityChecked) {
      message.warning('请先完成步骤5');
      return;
    }
    if (!selectedTenantId) {
      message.error('请先选择目标租户');
      return;
    }
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    setSqlConfirmed(true);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已确认完成执行 SQL');
  };

  const handleVerifyExternal = async () => {
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    if (!sqlConfirmed) {
      message.warning('请先完成步骤6');
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
            { title: '域名录入', status: stepDone[0] ? 'finish' : activeStep === 0 ? 'process' : 'wait' },
            { title: '子域名生成', status: stepDone[1] ? 'finish' : activeStep === 1 ? 'process' : 'wait' },
            { title: 'DCDN配置', status: stepDone[2] ? 'finish' : activeStep === 2 ? 'process' : 'wait' },
            { title: 'Ingress应用', status: stepDone[3] ? 'finish' : activeStep === 3 ? 'process' : 'wait' },
            { title: '联通性检查', status: stepDone[4] ? 'finish' : activeStep === 4 ? 'process' : 'wait' },
            { title: '数据库SQL', status: stepDone[5] ? 'finish' : activeStep === 5 ? 'process' : 'wait' },
            { title: '外部API验收', status: stepDone[6] ? 'finish' : activeStep === 6 ? 'process' : 'wait' },
          ]}
        />
      </Card>

      <Card title="步骤1：购买备案域名并确认一级域名" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="先选择目标租户"
            description="步骤6 的 tenant_domain SQL 会自动使用这里选择的租户 ID。"
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
            onChange={(e) => setRootDomainInput(e.target.value)}
            placeholder="例如 sample.com"
          />
          <Space>
            <Button type="primary" onClick={handleConfirmRootDomain}>
              确认一级域名
            </Button>
            {confirmedRootDomain ? <Tag color="blue">{confirmedRootDomain}</Tag> : null}
          </Space>
        </Space>
      </Card>

      <Card title="步骤2：根据步骤1域名生成线路子域名" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text>推荐命令：<Text code>openssl rand -hex 16</Text></Text>
          <Text type="secondary">系统将生成随机前缀（12~20位十六进制）并与步骤1域名拼接，示例：f0c15ebd6dc50f8.sample.com</Text>
          <Space>
            <Button onClick={handleGenerateSubdomain} disabled={!confirmedRootDomain}>
              生成子域名
            </Button>
            <Button type="primary" onClick={handleConfirmSubdomain} disabled={!generatedSubdomain}>
              确认子域名
            </Button>
          </Space>
          <Input
            value={generatedSubdomain}
            onChange={(e) => setGeneratedSubdomain(e.target.value)}
            placeholder="生成结果"
            disabled={!confirmedRootDomain}
          />
          {confirmedSubdomain ? <Tag color="green">{confirmedSubdomain}</Tag> : null}
        </Space>
      </Card>

      <Card title="步骤3：阿里云国际 DCDN 自动创建 + HTTPS/WebSocket/WAF 自动化" style={{ marginBottom: 12 }}>
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
          <Alert
            type="info"
            showIcon
            message="操作顺序"
            description="先输入源站域名并点击“1) 创建/复用 DCDN 域名”，成功后再配置 HTTPS/WebSocket/WAF，最后刷新状态。"
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
          <Text strong>2) 配置 HTTPS/WebSocket/WAF</Text>
          <Text type="secondary">
            推荐证书来源：CAS（云盾SSL证书中心）。也保留直传模式作为备用。
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
            <Radio.Button value="cas">CAS（推荐）</Radio.Button>
            <Radio.Button value="upload">直传（备用）</Radio.Button>
          </Radio.Group>

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
          <Button
            type="primary"
            loading={dcdnSecurityApplying}
            onClick={handleApplyDcdnSecurity}
            disabled={!dcdnAutoResult?.domainName}
          >
            应用 HTTPS / WebSocket / WAF 配置
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
                  <Text>证书来源：{securityApplyResult.certSource === 'upload' ? '直传（备用）' : 'CAS（云盾SSL证书中心）'}</Text>
                  <Text>CAS证书ID：{securityApplyResult.certId || '-'}</Text>
                  <Text>HTTPS 配置：{securityApplyResult.httpsConfigured ? '成功' : '失败'}</Text>
                  <Text>WebSocket 配置：{securityApplyResult.websocketConfigured ? '成功' : '失败'}</Text>
                  <Text>WAF 配置：{securityApplyResult.wafConfigured ? '成功' : '失败'}</Text>
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

      <Card title="步骤4：Ingress 克隆并应用（自动）" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="手动选择 source ingress 后执行克隆"
            description="当前先复用 resolve-source 能力加载候选；source ingress 由人工显式选择，目标 host 固定使用步骤2生成的新子域名。"
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
              onChange={(value) => setSelectedSourceIngressKey(value)}
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
          {sourceIngressError ? <Alert type="error" showIcon message={sourceIngressError} /> : null}
          <Space>
            <Button
              type="primary"
              loading={ingressApplying}
              onClick={handleCloneIngressApply}
              disabled={!confirmedSubdomain || !selectedSourceIngressKey}
            >
              执行 ingress 克隆应用
            </Button>
            {ingressApplied ? <Tag color="green">已执行</Tag> : null}
          </Space>

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

      <Card title="步骤5：超级后台登记与联通性检查" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">同一个环境仅有一个超级后台，与租户无关。</Text>
          <Text type="secondary">登记动作会通过当前环境 kubeContext 代理调用集群内超级后台接口。</Text>
          <Text strong>1) 在超级后台登记新线路</Text>
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
          <Text>
            联通性检查地址：
            <Text code>{connectivityUrl || 'https://{步骤2子域名}/pro/p/symbol/list'}</Text>
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
            disabled={!ingressApplied}
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
            disabled={!ingressApplied}
          />
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
              disabled={!ingressApplied}
            />
          </Space>
          <Space>
            <Button
              type="primary"
              loading={superAdminRegistering}
              onClick={handleConfirmSuperAdminRegistration}
              disabled={!ingressApplied || !selectedTenantId || !confirmedSubdomain}
            >
              确认并自动登记新线路
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

          <Divider style={{ margin: '4px 0' }} />
          <Text strong>2) 线路联通性检查</Text>
          <Space>
            <Button
              onClick={() => {
                if (!connectivityUrl) {
                  message.warning('请先完成步骤2');
                  return;
                }
                window.open(connectivityUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!ingressApplied || !superAdminRegistered}
            >
              打开检查地址
            </Button>
            <Button type="primary" onClick={handleConfirmConnectivity} disabled={!ingressApplied || !superAdminRegistered}>
              确认已完成联通性检查
            </Button>
            {connectivityChecked ? <Tag color="green">已确认</Tag> : null}
          </Space>
        </Space>
      </Card>

      <Card title="步骤6：在环境平台数据库新增 tenant_domain 数据" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">
            tenant_id 自动取自步骤1选择的目标租户。当前版本只输出 SQL，由你手工执行。
          </Text>
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
          <Paragraph code style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {insertSql}
          </Paragraph>
          <Space>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(insertSql);
                  message.success('SQL 已复制');
                } catch {
                  message.error('复制失败，请手工复制');
                }
              }}
              disabled={!connectivityChecked || !selectedTenantId}
            >
              复制 SQL
            </Button>
            <Button type="primary" onClick={handleConfirmSql} disabled={!connectivityChecked || !selectedTenantId}>
              确认已完成执行 SQL
            </Button>
            {sqlConfirmed ? <Tag color="green">已确认</Tag> : null}
          </Space>
        </Space>
      </Card>

      <Card title="步骤7：外部 API 验收">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="调用外部系统接口进行验收"
            description="接口地址：http://172.31.29.3:3000/api/lines（不是当前系统接口）"
          />
          <Space>
            <Button type="primary" loading={verifying} onClick={handleVerifyExternal} disabled={!sqlConfirmed}>
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
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary">已解析到的域名样本（最多展示20条）</Text>
              <Paragraph code style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
                {(verifyResult.discoveredHosts || []).slice(0, 20).join('\n') || '无'}
              </Paragraph>
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
            pagination={{ pageSize: 8, showSizeChanger: true }}
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
