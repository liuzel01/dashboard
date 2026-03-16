import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Radio,
  Space,
  Steps,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  applyDcdnSecurity,
  getDcdnDomainStatus,
  provisionDcdnDomain,
  verifyExternalLine,
} from '../services/api';

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

const SOURCE_INGRESS = '/home/ubuntu/kylin-script/k8s-yaml/ingress/app-ingress-0313.yaml';
const INGRESS_DIR = '/home/ubuntu/kylin-script/k8s-yaml/ingress';
const DOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const normalizeDomain = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

const generateHex = (length = 6) => {
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

const getMonthDay = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}${dd}`;
};

const LineOnboardingPage: React.FC = () => {
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
  const [dcdnConfirmed, setDcdnConfirmed] = useState(false);
  const [sslPubInput, setSslPubInput] = useState('');
  const [sslPriInput, setSslPriInput] = useState('');
  const [certNameInput, setCertNameInput] = useState('');
  const [certSource, setCertSource] = useState<'cas' | 'upload'>('cas');
  const [enableWebsocket, setEnableWebsocket] = useState(true);
  const [enableWaf, setEnableWaf] = useState(true);
  const [securityApplyResult, setSecurityApplyResult] = useState<DcdnSecurityApplyResult | null>(null);
  const [securityApplyError, setSecurityApplyError] = useState<string | null>(null);

  const [ingressApplied, setIngressApplied] = useState(false);
  const [connectivityChecked, setConnectivityChecked] = useState(false);
  const [tenantIdInput, setTenantIdInput] = useState('1');
  const [sqlConfirmed, setSqlConfirmed] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const monthDay = useMemo(() => getMonthDay(), []);
  const targetIngress = `${INGRESS_DIR}/app-ingress-${monthDay}.yaml`;
  const applyCommand = `kubectl apply -f ${targetIngress}`;
  const connectivityUrl = confirmedSubdomain ? `https://${confirmedSubdomain}/pro/p/symbol/list` : '';
  const tenantIdNormalized = tenantIdInput.trim() || '1';
  const insertSql = confirmedSubdomain
    ? `INSERT INTO tenant_domain (tenant_id, domian, status, created_time) VALUES (${tenantIdNormalized}, '${confirmedSubdomain}', 1, NOW());`
    : "INSERT INTO tenant_domain (tenant_id, domian, status, created_time) VALUES (1, '{步骤2子域名}', 1, NOW());";
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
    setDcdnCname('');
    setDcdnConfirmed(false);
    setIngressApplied(false);
    setConnectivityChecked(false);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
  };

  const resetFromStep3 = () => {
    setOriginDomainInput('');
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
    setEnableWebsocket(true);
    setEnableWaf(true);
    setSecurityApplyResult(null);
    setSecurityApplyError(null);
    setDcdnConfirmed(false);
    setIngressApplied(false);
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
    setConfirmedRootDomain(normalized);
    message.success(`已确认一级域名：${normalized}`);
  };

  const handleGenerateSubdomain = () => {
    if (!confirmedRootDomain) {
      message.warning('请先完成步骤1并确认一级域名');
      return;
    }
    const prefix = `${generateHex(6)}new`;
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
    setConfirmedSubdomain(candidate);
    message.success(`已确认线路子域名：${candidate}`);
  };

  const resetStep3Runtime = () => {
    setDcdnAutoResult(null);
    setDcdnAutoError(null);
    setDcdnLastRefreshAt(null);
    setDcdnCname('');
    setSecurityApplyError(null);
    setSecurityApplyResult(null);
    setDcdnConfirmed(false);
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
        originDomain: prev?.originDomain || originDomainInput || '-',
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
    if (!sslPubInput.trim() || !sslPriInput.trim()) {
      message.error('请提供 cert.crt 与 privkey.key 内容');
      return;
    }
    setDcdnSecurityApplying(true);
    setSecurityApplyError(null);
    setSecurityApplyResult(null);
    try {
      const result = (await applyDcdnSecurity({
        domainName: confirmedSubdomain,
        sslPub: sslPubInput.trim(),
        sslPri: sslPriInput.trim(),
        certName: certNameInput.trim() || undefined,
        certSource,
        enableWebsocket,
        enableWaf,
      })) as DcdnSecurityApplyResult;
      setSecurityApplyResult(result);
      if (result.status) {
        setDcdnAutoResult((prev) => ({
          domainName: result.status?.domainName || prev?.domainName || confirmedSubdomain,
          fetchedAt: result.status?.fetchedAt || new Date().toISOString(),
          originDomain: prev?.originDomain || originDomainInput || '-',
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
    setConnectivityChecked(false);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已确认 DCDN 配置');
  };

  const handleConfirmIngressApplied = () => {
    if (!dcdnConfirmed) {
      message.warning('请先完成步骤3');
      return;
    }
    setIngressApplied(true);
    setConnectivityChecked(false);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已标记 Ingress 已应用');
  };

  const handleConfirmConnectivity = () => {
    if (!ingressApplied) {
      message.warning('请先完成步骤4');
      return;
    }
    setConnectivityChecked(true);
    setSqlConfirmed(false);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已标记联通性检查完成');
  };

  const handleConfirmSql = () => {
    if (!connectivityChecked) {
      message.warning('请先完成步骤5');
      return;
    }
    if (!/^\d+$/.test(tenantIdNormalized)) {
      message.error('tenant_id 需为正整数');
      return;
    }
    if (!confirmedSubdomain) {
      message.warning('请先完成步骤2');
      return;
    }
    setSqlConfirmed(true);
    setVerifyResult(null);
    setVerifyError(null);
    message.success('已确认 SQL（请在环境平台数据库手工执行）');
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
          <Text type="secondary">系统将把随机前缀与步骤1域名拼接，示例：aaanew.sample.com</Text>
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
                  <Text>创建时间：{dcdnAutoResult.createdAt || '-'}</Text>
                  <Text>更新时间：{dcdnAutoResult.updatedAt || '-'}</Text>
                  <Text>资源组：{dcdnAutoResult.resourceGroupId || '-'}</Text>
                  <Text>
                    最近刷新：
                    {dcdnLastRefreshAt
                      ? new Date(dcdnLastRefreshAt).toLocaleString('zh-CN', { hour12: false })
                      : '-'}
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
            onChange={(e) => setCertSource(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            disabled={!dcdnAutoResult?.domainName}
          >
            <Radio.Button value="cas">CAS（推荐）</Radio.Button>
            <Radio.Button value="upload">直传（备用）</Radio.Button>
          </Radio.Group>
          <Space wrap>
            <Button onClick={() => document.getElementById('dcdn-cert-file')?.click()} disabled={!dcdnAutoResult?.domainName}>
              读取 cert.crt
            </Button>
            <Button onClick={() => document.getElementById('dcdn-key-file')?.click()} disabled={!dcdnAutoResult?.domainName}>
              读取 privkey.key
            </Button>
          </Space>
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
            placeholder="证书名称（可选，默认 {子域名}-cert）"
            disabled={!dcdnAutoResult?.domainName}
          />
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

      <Card title="步骤4：Ingress 文件复制并应用" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text code>cp {SOURCE_INGRESS} {targetIngress}</Text>
          <Text code>{applyCommand}</Text>
          <Space>
            <Button type="primary" onClick={handleConfirmIngressApplied} disabled={!dcdnConfirmed}>
              标记已执行 apply
            </Button>
            {ingressApplied ? <Tag color="green">已执行</Tag> : null}
          </Space>
        </Space>
      </Card>

      <Card title="步骤5：超级后台登记与联通性检查" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">同一个环境仅有一个超级后台，与租户无关。</Text>
          <Text>
            联通性检查地址：
            <Text code>{connectivityUrl || 'https://{步骤2子域名}/pro/p/symbol/list'}</Text>
          </Text>
          <Space>
            <Button
              onClick={() => {
                if (!connectivityUrl) {
                  message.warning('请先完成步骤2');
                  return;
                }
                window.open(connectivityUrl, '_blank', 'noopener,noreferrer');
              }}
              disabled={!ingressApplied}
            >
              打开检查地址
            </Button>
            <Button type="primary" onClick={handleConfirmConnectivity} disabled={!ingressApplied}>
              已完成联通性检查
            </Button>
            {connectivityChecked ? <Tag color="green">已确认</Tag> : null}
          </Space>
        </Space>
      </Card>

      <Card title="步骤6：在环境平台数据库新增 tenant_domain 数据" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">
            tenant_id 是当前环境中对应租户 ID。当前版本只输出 SQL，由你手工执行。
          </Text>
          <Input
            value={tenantIdInput}
            onChange={(e) => {
              setTenantIdInput(e.target.value);
              setSqlConfirmed(false);
            }}
            placeholder="tenant_id，例如 1"
            disabled={!connectivityChecked}
          />
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
              disabled={!connectivityChecked}
            >
              复制 SQL
            </Button>
            <Button type="primary" onClick={handleConfirmSql} disabled={!connectivityChecked}>
              已手工执行 SQL
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
    </div>
  );
};

export default LineOnboardingPage;
