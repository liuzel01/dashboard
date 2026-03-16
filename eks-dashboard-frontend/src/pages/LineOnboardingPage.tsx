import React, { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Space,
  Steps,
  Tag,
  Typography,
  message,
} from 'antd';
import { provisionDcdnDomain, verifyExternalLine } from '../services/api';

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
  originDomain: string;
  scope: 'global' | 'domestic' | 'overseas';
  created: boolean;
  cname: string | null;
  domainStatus?: string | null;
  verifyRequired?: boolean;
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
  const [dcdnConfirmed, setDcdnConfirmed] = useState(false);

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
    try {
      const result = (await provisionDcdnDomain({
        domainName: confirmedSubdomain,
        originDomain: originHost,
        scope: 'global',
      })) as DcdnProvisionResult;
      setDcdnAutoResult(result);
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

      <Card title="步骤3：阿里云国际 DCDN 自动创建" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Text type="secondary">
            使用步骤2确认的线路域名：{confirmedSubdomain || '(待确认)'}
          </Text>
          <Input
            value={originDomainInput}
            onChange={(e) => {
              setOriginDomainInput(e.target.value);
              setDcdnConfirmed(false);
            }}
            placeholder="输入源站域名（例如 origin.sample.com）"
            disabled={!confirmedSubdomain}
          />
          <Space>
            <Button
              type="primary"
              loading={dcdnProvisioning}
              onClick={handleProvisionDcdn}
              disabled={!confirmedSubdomain}
            >
              自动创建 DCDN 域名
            </Button>
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
                  <Text>状态：{dcdnAutoResult.domainStatus || '-'}</Text>
                  <Text>CNAME：{dcdnAutoResult.cname || '(暂未返回，请稍后刷新或手工查询)'}</Text>
                  {dcdnAutoResult.verifyRequired ? (
                    <Text type="warning">可能仍需人工做域名校验/等待配置生效。</Text>
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
