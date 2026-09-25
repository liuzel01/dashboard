import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Select, Space, Steps, Typography } from 'antd';
import { CheckCircleOutlined, FileSearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { applyIngressManifestForLineOnboarding, applyTenantDomainForLineOnboarding, getIngressSourceCandidatesForLineOnboarding, getTenantsForEnvironment, previewCloneIngressForLineOnboarding } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';

const { Text, Paragraph } = Typography;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const K8S_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type Tenant = { id: number; name: string };
type Candidate = { namespace: string; name: string; ruleHosts?: string[]; lbAddresses?: string[]; createdAt?: string | null };
type Preview = { newIngressName: string; namespace: string; host: string; sourceIngressName: string; yaml?: string };
type TenantDomainResult = { action: 'created' | 'unchanged'; id?: number; tenantId: number; domain: string; status: number };
type DryRunResult = { newIngressName: string; namespace: string; host: string; warnings?: Array<{ annotation: string; message: string }> };

const readableError = (error: any, fallback: string) => {
  const message = error?.response?.data?.message;
  return Array.isArray(message) ? message.join('; ') : message || error?.message || fallback;
};

const AdminSiteIngressPage: React.FC = () => {
  const { message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<number>();
  const [domain, setDomain] = useState('');
  const [candidateKeyword, setCandidateKeyword] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateKey, setCandidateKey] = useState<string>();
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [ingressName, setIngressName] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [manifestYaml, setManifestYaml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult>();
  const [dryRunning, setDryRunning] = useState(false);
  const [tenantDomain, setTenantDomain] = useState<TenantDomainResult>();
  const [writingTenantDomain, setWritingTenantDomain] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ namespace: string; newIngressName: string; host: string }>();
  const operationInProgress = candidatesLoading || previewing || dryRunning || writingTenantDomain || creating;

  const selectedCandidate = useMemo(() => candidates.find((candidate) => `${candidate.namespace}/${candidate.name}` === candidateKey), [candidates, candidateKey]);
  const normalizedDomain = domain.trim().toLowerCase();
  const tenantDomainSql = tenantId && normalizedDomain
    ? `INSERT INTO tenant.tenant_domain (tenant_id, domian, status, created_time) VALUES (${tenantId}, '${normalizedDomain}', 1, NOW());`
    : "INSERT INTO tenant.tenant_domain (tenant_id, domian, status, created_time) VALUES ({租户ID}, '{管理端域名}', 1, NOW());";

  useEffect(() => {
    let cancelled = false;
    setTenants([]); setTenantId(undefined); setCandidates([]); setCandidateKey(undefined); setPreview(undefined); setManifestYaml(''); setIngressName(''); setDryRun(undefined); setTenantDomain(undefined); setCreated(undefined);
    if (!currentEnvironment?.id) return;
    getTenantsForEnvironment(currentEnvironment.id).then((data) => {
      if (cancelled) return;
      const values = Array.isArray(data) ? data.map((item: any) => ({ id: Number(item.id), name: String(item.name || '') })).filter((item) => Number.isInteger(item.id) && item.id > 0) : [];
      setTenants(values); setTenantId(values[0]?.id);
    }).catch((error) => { if (!cancelled) message.error(readableError(error, '加载租户列表失败')); });
    return () => { cancelled = true; };
  }, [currentEnvironment?.id, message]);

  const resetDownstream = () => { setPreview(undefined); setManifestYaml(''); setDryRun(undefined); setTenantDomain(undefined); setCreated(undefined); };
  const loadCandidates = async () => {
    if (!currentEnvironment?.id) return;
    if (operationInProgress) {
      message.info('请等待当前操作完成后再加载候选 Ingress');
      return;
    }
    // 候选加载开启新的配置轮次，不能沿用上一域名的 Ingress 名称或预览结果。
    setCandidatesLoading(true); setCandidates([]); setCandidateKey(undefined); setIngressName(''); resetDownstream();
    try {
      const response = await getIngressSourceCandidatesForLineOnboarding({ environmentId: currentEnvironment.id, keyword: candidateKeyword.trim() || undefined }) as { data?: { items?: Candidate[] } };
      const values = response?.data?.items || [];
      setCandidates(values); setCandidateKey(values[0] ? `${values[0].namespace}/${values[0].name}` : undefined);
      if (!values.length) message.warning('未找到匹配的 Ingress 候选，请调整关键词后重试');
    } catch (error) { message.error(readableError(error, '加载 Ingress 候选失败')); } finally { setCandidatesLoading(false); }
  };
  const generatePreview = async () => {
    if (operationInProgress) {
      message.info('请等待当前操作完成后再生成 YAML 预览');
      return;
    }
    if (!currentEnvironment?.id || !selectedCandidate) return message.warning('请先选择候选 Ingress');
    if (!DOMAIN_PATTERN.test(normalizedDomain)) return message.error('请输入有效的管理端域名');
    const name = ingressName.trim().toLowerCase();
    if (name && !K8S_NAME_PATTERN.test(name)) return message.error('Ingress 名称只能使用小写字母、数字和中划线');
    setPreviewing(true); resetDownstream();
    try {
      const response = await previewCloneIngressForLineOnboarding({ environmentId: currentEnvironment.id, namespace: selectedCandidate.namespace, sourceIngressName: selectedCandidate.name, newHost: normalizedDomain, ...(name ? { newIngressName: name } : {}) }) as { data?: Preview };
      if (!response.data?.yaml) throw new Error('预览未返回 YAML');
      setPreview(response.data); setManifestYaml(response.data.yaml); setIngressName(response.data.newIngressName); message.success('Ingress YAML 已生成，可编辑后进行 dry-run');
    } catch (error) { message.error(readableError(error, '生成 Ingress YAML 预览失败')); } finally { setPreviewing(false); }
  };
  const executeDryRun = async () => {
    if (operationInProgress) {
      message.info('请等待当前操作完成后再执行 dry-run');
      return;
    }
    if (!currentEnvironment?.id || !preview || !manifestYaml.trim()) return message.warning('请先生成并填写 Ingress YAML');
    setDryRunning(true); setDryRun(undefined); setTenantDomain(undefined); setCreated(undefined);
    try {
      const response = await applyIngressManifestForLineOnboarding({ environmentId: currentEnvironment.id, sourceIngressName: preview.sourceIngressName, manifestYaml, confirmed: false }) as { data?: DryRunResult };
      if (!response.data?.newIngressName) throw new Error('dry-run 未返回目标 Ingress');
      setDryRun(response.data); message.success('Kubernetes dry-run 校验通过');
    } catch (error) { message.error(readableError(error, 'Ingress dry-run 校验失败')); } finally { setDryRunning(false); }
  };
  const writeTenantDomain = () => {
    if (operationInProgress) {
      message.info('请等待当前操作完成后再写入 tenant_domain');
      return;
    }
    if (!currentEnvironment?.id || !tenantId || !dryRun) return message.warning('请先选择租户并通过 dry-run');
    let otpCode = '';
    Modal.confirm({ title: '验证 MFA 并确认写入 tenant_domain', width: 620, content: <Space direction="vertical" size={8} style={{ width: '100%' }}><Text>将向当前环境的 tenant_domain 写入管理端域名：</Text><Text code>{normalizedDomain}</Text><Text type="secondary">实际写入使用参数化 SQL，以下内容仅供本次确认核对：</Text><Paragraph code style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{tenantDomainSql}</Paragraph><Input.Password maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="输入当前 Google Authenticator 6 位验证码" onChange={(event) => { otpCode = event.target.value.replace(/\s+/g, ''); }} /></Space>, okText: '验证并写入', cancelText: '返回检查', onOk: async () => {
      if (!/^\d{6}$/.test(otpCode)) {
        message.error('请输入当前有效的 6 位 Google Authenticator 验证码');
        throw new Error('MFA_REQUIRED');
      }
      setWritingTenantDomain(true);
      try {
        const response = await applyTenantDomainForLineOnboarding({ environmentId: currentEnvironment.id, tenantId, domain: normalizedDomain, otpCode }) as { success?: boolean; data?: TenantDomainResult };
        if (!response.success || !response.data) throw new Error('tenant_domain 写入未返回成功结果');
        setTenantDomain(response.data); message.success(response.data.action === 'created' ? 'tenant_domain 已写入' : 'tenant_domain 已存在，无需重复写入');
      } catch (error) { message.error(readableError(error, 'tenant_domain 写入失败')); throw error; } finally { setWritingTenantDomain(false); }
    }});
  };
  const createIngress = () => {
    if (operationInProgress) {
      message.info('请等待当前操作完成后再创建 Ingress');
      return;
    }
    if (!currentEnvironment?.id || !preview || !dryRun || !tenantDomain) return message.warning('请先完成 dry-run 与 tenant_domain 写入');
    const warnings = dryRun.warnings || [];
    Modal.confirm({ title: warnings.length ? '确认创建：存在高风险配置' : '确认创建 Ingress', width: 700, content: <Space direction="vertical" style={{ width: '100%' }}><Text>将在 <Text code>{dryRun.namespace}/{dryRun.newIngressName}</Text> 创建 Ingress。</Text>{warnings.length ? <Alert type="warning" showIcon message="以下字段可能改变流量、认证或 Nginx 行为" description={warnings.map((warning) => <div key={warning.annotation}><Text code>{warning.annotation}</Text>：{warning.message}</div>)} /> : null}<Text type="secondary">tenant_domain 已完成写入；创建失败时请根据错误信息处理，勿重复写入。</Text></Space>, okText: '确认创建', cancelText: '返回编辑', onOk: async () => {
      setCreating(true);
      try {
        const response = await applyIngressManifestForLineOnboarding({ environmentId: currentEnvironment.id, sourceIngressName: preview.sourceIngressName, manifestYaml, confirmed: true }) as { data?: { namespace: string; newIngressName: string; host: string } };
        if (!response.data?.newIngressName) throw new Error('创建未返回目标 Ingress');
        setCreated(response.data); message.success(`Ingress 创建成功：${response.data.newIngressName}`);
      } catch (error) { message.error(readableError(error, 'Ingress 创建失败')); throw error; } finally { setCreating(false); }
    }});
  };

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Steps current={created ? 4 : tenantDomain ? 3 : dryRun ? 2 : preview ? 1 : 0} items={[{ title: '选择源站' }, { title: '编辑与预览' }, { title: 'Dry-run' }, { title: '写入域名' }, { title: '创建完成' }]} />
    <Card title="1. 选择管理端域名和 Ingress 源站">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Descriptions size="small" column={1}><Descriptions.Item label="目标环境">{currentEnvironment?.name || currentEnvironment?.id || '未选择'}</Descriptions.Item></Descriptions>
        <Space wrap><Select value={tenantId} loading={!tenants.length && !!currentEnvironment} onChange={(value) => { setTenantId(value); setIngressName(''); resetDownstream(); }} style={{ width: 280 }} placeholder="选择目标租户" options={tenants.map((tenant) => ({ value: tenant.id, label: `${tenant.id} - ${tenant.name}` }))} showSearch optionFilterProp="label" /><Input value={domain} onChange={(event) => { setDomain(event.target.value); setIngressName(''); resetDownstream(); }} placeholder="新管理端域名，例如 admin.example.com" style={{ width: 320 }} /></Space>
        <Space wrap><Input value={candidateKeyword} onChange={(event) => setCandidateKeyword(event.target.value)} onPressEnter={() => void loadCandidates()} placeholder="按名称或 Host 筛选候选 Ingress" style={{ width: 320 }} /><Button icon={<FileSearchOutlined />} loading={candidatesLoading} disabled={operationInProgress} onClick={() => void loadCandidates()}>加载候选 Ingress</Button></Space>
        {candidates.length ? <Select value={candidateKey} onChange={(value) => { setCandidateKey(value); setIngressName(''); resetDownstream(); }} style={{ width: '100%' }} options={candidates.map((candidate) => ({ value: `${candidate.namespace}/${candidate.name}`, label: `${candidate.namespace}/${candidate.name}${candidate.ruleHosts?.length ? ` · ${candidate.ruleHosts.join(', ')}` : ''}` }))} showSearch optionFilterProp="label" /> : null}
      </Space>
    </Card>
    <Card title="2. 生成并编辑 Ingress YAML">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap><Input value={ingressName} onChange={(event) => { setIngressName(event.target.value); resetDownstream(); }} placeholder="新 Ingress 名称（可留空自动生成）" style={{ width: 320 }} /><Button type="primary" loading={previewing} onClick={() => void generatePreview()} disabled={operationInProgress || !selectedCandidate || !normalizedDomain}>生成 YAML 预览</Button></Space>
        {preview ? <Input.TextArea value={manifestYaml} onChange={(event) => { setManifestYaml(event.target.value); setDryRun(undefined); setTenantDomain(undefined); setCreated(undefined); }} rows={18} spellCheck={false} /> : <Text type="secondary">选择源站并填写域名后生成预览。</Text>}
      </Space>
    </Card>
    <Card title="3. 校验、写入 tenant_domain 并创建">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Button icon={<SafetyCertificateOutlined />} loading={dryRunning} disabled={operationInProgress || !preview || !manifestYaml.trim()} onClick={() => void executeDryRun()}>执行 Kubernetes dry-run</Button>
        {dryRun ? <Alert type={dryRun.warnings?.length ? 'warning' : 'success'} showIcon message={dryRun.warnings?.length ? 'dry-run 通过，但检测到高风险字段' : 'dry-run 校验通过'} description={<Space direction="vertical"><Text>目标：<Text code>{dryRun.namespace}/{dryRun.newIngressName}</Text></Text>{dryRun.warnings?.map((warning) => <Text key={warning.annotation}><Text code>{warning.annotation}</Text>：{warning.message}</Text>)}</Space>} /> : null}
        <Space wrap><Button loading={writingTenantDomain} disabled={operationInProgress || !dryRun || !tenantId} onClick={writeTenantDomain}>确认写入 tenant_domain</Button><Button type="primary" danger icon={<CheckCircleOutlined />} loading={creating} disabled={operationInProgress || !tenantDomain || !dryRun} onClick={createIngress}>最终确认并创建 Ingress</Button></Space>
        {tenantDomain ? <Alert type="success" showIcon message={tenantDomain.action === 'created' ? 'tenant_domain 写入成功' : 'tenant_domain 已存在'} description={`Tenant ID: ${tenantDomain.tenantId}；Domain: ${tenantDomain.domain}；记录 ID: ${tenantDomain.id || '-'}`} /> : null}
        {created ? <Alert type="success" showIcon message="管理端网站 Ingress 已创建" description={<Text><Text code>{created.namespace}/{created.newIngressName}</Text> · {created.host}</Text>} /> : null}
      </Space>
    </Card>
  </Space>;
};

export default AdminSiteIngressPage;
