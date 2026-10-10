import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { PlayCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import { AuthContext } from '../contexts/AuthContextValue';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import {
  diagnoseCicdExecutor,
  discoverCicdJobs,
  getCicdDiscoveredJobDetail,
  getCicdEnvironmentBindings,
  getCicdExecutors,
  reconcileCicdCatalog,
  cancelCicdRun,
  getCicdRunLog,
  listCicdRuns,
  refreshCicdRun,
  triggerCicdRun,
  type CicdActionType,
  type CicdDiscoveredJob,
  type CicdDiscoveredJobDetail,
  type CicdEnvironmentBinding,
  type CicdExecutor,
  type CicdExecutorDiagnostic,
  type CicdReconciliation,
  type CicdRun,
} from '../services/api';

const { Text, Title } = Typography;
const actionOptions = [
  { value: 'BUILD_DEPLOY', label: '构建部署' },
  { value: 'PACKAGE_PUBLISH', label: '制品推包' },
  { value: 'IMAGE_BUILD_PUBLISH', label: '现货镜像构建推包' },
] as const;

const errorMessage = (error: unknown, fallback: string) =>
  (error as ApiError)?.response?.data?.message || (error as ApiError)?.message || fallback;

const CicdCatalogPage: React.FC = () => {
  const { message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const { permissions } = useContext(AuthContext);
  const canManage = permissions.includes('cicd-config:manage');
  const canExecuteBuild = permissions.includes('cicd-runs:execute-build');
  const canExecutePublish = permissions.includes('cicd-runs:execute-publish');
  const canExecuteImagePublish = permissions.includes('cicd-runs:execute-image-publish');
  const canCancel = permissions.includes('cicd-runs:cancel');
  const [form] = Form.useForm();
  const [actionType, setActionType] = useState<CicdActionType>('BUILD_DEPLOY');
  const [bindings, setBindings] = useState<CicdEnvironmentBinding[]>([]);
  const [executors, setExecutors] = useState<CicdExecutor[]>([]);
  const [jobs, setJobs] = useState<CicdDiscoveredJob[]>([]);
  const [selectedJobName, setSelectedJobName] = useState<string>();
  const [selectedJob, setSelectedJob] = useState<CicdDiscoveredJobDetail>();
  const [filterMode, setFilterMode] = useState<'ALL' | 'PATTERN'>('ALL');
  const [loading, setLoading] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [diagnostic, setDiagnostic] = useState<CicdExecutorDiagnostic>();
  const [reconciliation, setReconciliation] = useState<CicdReconciliation>();
  const [runs, setRuns] = useState<CicdRun[]>([]);
  const [executing, setExecuting] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState('');

  useEffect(() => {
    Promise.all([getCicdEnvironmentBindings(), getCicdExecutors()])
      .then(([nextBindings, nextExecutors]) => { setBindings(nextBindings); setExecutors(nextExecutors); })
      .catch((error) => message.error(errorMessage(error, 'CI/CD 目录配置加载失败')));
  }, [message]);

  useEffect(() => {
    setJobs([]);
    setSelectedJobName(undefined);
    setSelectedJob(undefined);
    setDiagnostic(undefined);
    setReconciliation(undefined);
    if (!currentEnvironment?.id) return;
    setLoading(true);
    discoverCicdJobs(currentEnvironment.id, actionType)
      .then((result) => { setJobs(result.jobs); setFilterMode(result.filterMode); })
      .catch((error) => message.error(errorMessage(error, 'CI/CD Job 目录加载失败')))
      .finally(() => setLoading(false));
  }, [currentEnvironment?.id, actionType, message]);

  const loadRuns = React.useCallback(() => {
    if (!currentEnvironment?.id) return;
    listCicdRuns(currentEnvironment.id).then(setRuns).catch((error) => message.error(errorMessage(error, '执行记录加载失败')));
  }, [currentEnvironment?.id, message]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const binding = useMemo(
    () => bindings.find((item) => item.environment_id === currentEnvironment?.id && item.action_type === actionType),
    [bindings, currentEnvironment?.id, actionType],
  );
  const executor = executors.find((item) => item.executor_key === binding?.executor_key);
  const selectJob = async (jobName?: string) => {
    setSelectedJobName(jobName);
    setSelectedJob(undefined);
    if (!jobName || !currentEnvironment?.id) return;
    setLoading(true);
    try {
      const detail = await getCicdDiscoveredJobDetail(currentEnvironment.id, actionType, jobName);
      setSelectedJob(detail);
      form.resetFields();
      form.setFieldsValue(Object.fromEntries(detail.remoteParameters.map((item) => [item.name, item.default])));
    }
    catch (error) { message.error(errorMessage(error, 'Jenkins Job 参数加载失败')); }
    finally { setLoading(false); }
  };

  const execute = async () => {
    if (!selectedJob || !currentEnvironment?.id) return;
    const values = await form.validateFields();
    const confirmation = actionType !== 'BUILD_DEPLOY'
      ? await new Promise<string | undefined>((resolve) => {
          let value = '';
          Modal.confirm({
            title: '确认执行制品推包',
            content: <Space direction="vertical" style={{ width: '100%' }}><Alert type="warning" showIcon message="该操作可能向目标仓库发布制品，请核对环境、Job 和参数。" /><Input placeholder="输入：确认推包" onChange={(event) => { value = event.target.value; }} /></Space>,
            okText: '确认触发', cancelText: '取消',
            onOk: () => value === '确认推包' ? resolve(value) : Promise.reject(new Error('请输入“确认推包”')),
            onCancel: () => resolve(undefined),
          });
        })
      : await new Promise<string | undefined>((resolve) => Modal.confirm({ title: '确认触发 Jenkins Job？', content: `${currentEnvironment.name} / ${selectedJob.name}`, okText: '确认触发', cancelText: '取消', onOk: () => resolve('confirmed'), onCancel: () => resolve(undefined) }));
    if (!confirmation) return;
    setExecuting(true);
    try {
      const run = await triggerCicdRun({ environmentId: currentEnvironment.id, actionType, jobName: selectedJob.name, clientRequestId: crypto.randomUUID(), parameters: values, ...(actionType !== 'BUILD_DEPLOY' ? { confirmation } : {}) });
      message.success(`已进入 Jenkins 队列 #${run.queue_id || '-'}`);
      loadRuns();
    } catch (error) { message.error(errorMessage(error, 'Jenkins 触发失败')); }
    finally { setExecuting(false); }
  };

  const refreshRun = async (runId: string) => {
    try { await refreshCicdRun(runId); loadRuns(); }
    catch (error) { message.error(errorMessage(error, '执行状态刷新失败')); }
  };

  const showLog = async (runId: string) => {
    try { const result = await getCicdRunLog(runId); setLogText(result.text || '暂无日志'); setLogOpen(true); }
    catch (error) { message.error(errorMessage(error, 'Jenkins 日志读取失败')); }
  };

  const runDiagnostic = async () => {
    if (!binding?.executor_key) return;
    setDiagnosing(true);
    setDiagnostic(undefined);
    try { setDiagnostic(await diagnoseCicdExecutor(binding.executor_key)); }
    catch (error) { message.error(errorMessage(error, 'Jenkins 连接检查失败')); }
    finally { setDiagnosing(false); }
  };

  const runReconciliation = async () => {
    if (!currentEnvironment?.id) return;
    setReconciling(true);
    setReconciliation(undefined);
    try { setReconciliation(await reconcileCicdCatalog(currentEnvironment.id, actionType)); }
    catch (error) { message.error(errorMessage(error, 'Job 参数对账失败')); }
    finally { setReconciling(false); }
  };

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>CI/CD 执行中心</Title>
      <Text type="secondary">选择当前环境的 Jenkins Job，核对真实参数后执行构建部署或制品推包，并在页面追踪队列、日志和结果。</Text>
    </div>

    <Card>
      <Space wrap size={16}>
        <Space direction="vertical" size={4}>
          <Text type="secondary">目标环境</Text>
          <Text strong>{currentEnvironment ? `${currentEnvironment.name} (${currentEnvironment.id})` : '请先在左上角选择环境'}</Text>
        </Space>
        <Space direction="vertical" size={4}>
          <Text type="secondary">操作类型</Text>
          <Select<CicdActionType> value={actionType} onChange={setActionType} options={[...actionOptions]} style={{ width: 180 }} />
        </Space>
        <Space direction="vertical" size={4}>
          <Text type="secondary">受控 Job</Text>
          <Select
            showSearch
            allowClear
            loading={loading}
            value={selectedJobName}
            onChange={selectJob}
            placeholder="输入服务名或 Job 名模糊匹配"
            optionFilterProp="label"
            style={{ width: 360 }}
            options={jobs.map((job) => ({ value: job.name, label: `${job.name}${job.disabled ? '（已禁用）' : ''}` , disabled: job.disabled }))}
          />
        </Space>
      </Space>
    </Card>

    {!binding ? <Alert type="info" showIcon message="当前环境尚未录入此操作类型的 CI/CD 绑定" />
      : !binding.enabled ? <Alert type="warning" showIcon message="当前环境的 CI/CD 绑定已停用" />
      : <Card title="执行器绑定" extra={<Tag color={executor?.read_only ? 'default' : 'success'}>{executor?.read_only ? '只读' : '可执行'}</Tag>}>
          <Descriptions size="small" column={{ xs: 1, md: 2, lg: 3 }}>
            <Descriptions.Item label="Executor">{binding.executor_display_name || binding.executor_key}</Descriptions.Item>
            <Descriptions.Item label="Provider">{binding.provider_type}</Descriptions.Item>
            <Descriptions.Item label="Job 发现范围">{filterMode === 'ALL' ? <Tag color="blue">全部可读 Job</Tag> : <Text code>{binding.job_name_pattern}</Text>}</Descriptions.Item>
            <Descriptions.Item label="连接配置">{executor?.configured ? <Tag color="success">已配置</Tag> : <Tag color="warning">未配置</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Jenkins Host">{executor?.host || '-'}</Descriptions.Item>
            <Descriptions.Item label="目录数量">{jobs.length}</Descriptions.Item>
          </Descriptions>
          <Space style={{ marginTop: 16 }}>
            <Button icon={<SafetyCertificateOutlined />} loading={diagnosing} disabled={!canManage || !executor?.configured || binding.provider_type !== 'JENKINS'} onClick={runDiagnostic}>连接检查</Button>
            <Button icon={<ReloadOutlined />} loading={reconciling} disabled={!canManage || !executor?.configured || binding.provider_type !== 'JENKINS'} onClick={runReconciliation}>Job / 参数对账</Button>
            {!canManage && <Text type="secondary">需要 cicd-config:manage 权限</Text>}
          </Space>
        </Card>}

    {selectedJob && <Card title="Job 参数契约">
      {actionType === 'IMAGE_BUILD_PUBLISH' && <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="外部系统能力受限"
        description="该系统不提供实时日志、进度查询或取消接口。网络超时或 Dashboard 中断会标记为 UNKNOWN，系统不会自动重试，需要人工确认远端结果。"
      />}
      <Descriptions size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label={actionType === 'IMAGE_BUILD_PUBLISH' ? '外部服务' : 'Jenkins Job'}><Text code>{selectedJob.name}</Text></Descriptions.Item>
        <Descriptions.Item label="Buildable">{selectedJob.buildable ? '是' : '否'}</Descriptions.Item>
        <Descriptions.Item label="Jenkins 并发">{selectedJob.concurrentBuild ? '允许' : '禁止'}</Descriptions.Item>
        <Descriptions.Item label="Catalog">{selectedJob.registered ? <Tag color="success">已登记增强策略</Tag> : <Tag>远端动态发现</Tag>}</Descriptions.Item>
      </Descriptions>
      <Table
        style={{ marginTop: 16 }}
        size="small"
        pagination={false}
        rowKey="name"
        dataSource={selectedJob.remoteParameters}
        columns={[
          { title: '参数', dataIndex: 'name' },
          { title: '类型', dataIndex: 'type' },
          { title: '默认值', dataIndex: 'default', render: (value) => value === undefined || value === '' ? '-' : String(value) },
        ]}
      />
      <Form form={form} layout="vertical" style={{ marginTop: 20 }}>
        {selectedJob.remoteParameters.map((parameter) => <Form.Item key={parameter.name} name={parameter.name} label={parameter.name} tooltip={parameter.type} valuePropName={String(parameter.type).includes('Boolean') ? 'checked' : 'value'}>
          {String(parameter.type).includes('Boolean') ? <Switch /> : parameter.choices?.length ? <Select options={parameter.choices.map((value) => ({ value, label: value }))} /> : <Input />}
        </Form.Item>)}
      </Form>
      <Button
        type="primary"
        danger={actionType !== 'BUILD_DEPLOY'}
        icon={<PlayCircleOutlined />}
        loading={executing}
        disabled={!selectedJob.buildable || !!executor?.read_only || (actionType === 'BUILD_DEPLOY' ? !canExecuteBuild : actionType === 'IMAGE_BUILD_PUBLISH' ? !canExecuteImagePublish : !canExecutePublish)}
        onClick={execute}
      >{actionType === 'BUILD_DEPLOY' ? '触发构建部署' : actionType === 'IMAGE_BUILD_PUBLISH' ? '触发现货镜像构建推包' : '触发制品推包'}</Button>
    </Card>}

    <Card title="最近执行" extra={<Button icon={<ReloadOutlined />} onClick={loadRuns}>刷新列表</Button>}>
      <Table size="small" rowKey="run_id" dataSource={runs} pagination={{ pageSize: 10 }} columns={[
        { title: '时间', dataIndex: 'created_at', width: 170 },
        { title: '类型', dataIndex: 'action_type', render: (value) => value === 'PACKAGE_PUBLISH' ? '制品推包' : value === 'IMAGE_BUILD_PUBLISH' ? '现货镜像构建推包' : '构建部署' },
        { title: 'Job', dataIndex: 'job_name' },
        { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'SUCCESS' ? 'success' : value === 'FAILURE' || value === 'ABORTED' ? 'error' : value === 'RUNNING' ? 'processing' : 'default'}>{value}</Tag> },
        { title: '队列 / Build / 镜像', render: (_, row) => row.action_type === 'IMAGE_BUILD_PUBLISH' ? (row.external_result_tag || '-') : `#${row.queue_id || '-'} / #${row.build_number || '-'}` },
        { title: '操作', render: (_, row) => <Space>
          <Button size="small" onClick={() => refreshRun(row.run_id)}>刷新</Button>
          <Button size="small" disabled={!row.build_number && row.action_type !== 'IMAGE_BUILD_PUBLISH'} onClick={() => showLog(row.run_id)}>日志</Button>
          <Button size="small" danger icon={<StopOutlined />} disabled={!canCancel || row.action_type === 'IMAGE_BUILD_PUBLISH' || ['SUCCESS', 'FAILURE', 'ABORTED', 'CANCELLED'].includes(row.status)} onClick={() => Modal.confirm({ title: '确认取消该 Jenkins 执行？', onOk: async () => { await cancelCicdRun(row.run_id); loadRuns(); } })}>取消</Button>
        </Space> },
      ]} />
    </Card>

    <Modal title="Jenkins 控制台日志" open={logOpen} onCancel={() => setLogOpen(false)} footer={<Button onClick={() => setLogOpen(false)}>关闭</Button>} width={900}>
      <pre style={{ maxHeight: 560, overflow: 'auto', whiteSpace: 'pre-wrap', background: '#111', color: '#ddd', padding: 16 }}>{logText}</pre>
    </Modal>

    {diagnostic && <Alert
      type={diagnostic.identity.authenticated ? 'success' : 'error'}
      showIcon
      message={`Jenkins 连接正常：${diagnostic.version || '版本未知'}`}
      description={`身份 ${diagnostic.identity.name || '-'}；Job ${diagnostic.jobCount}；禁用 ${diagnostic.disabledJobCount}；耗时 ${diagnostic.latencyMs}ms；Crumb ${diagnostic.api.crumb ? '正常' : '异常'}；Queue ${diagnostic.api.queue ? '正常' : '异常'}`}
    />}

    {reconciliation && <Card title="Job / 参数对账结果" extra={<Text type="secondary">规则 {reconciliation.pattern}</Text>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Tag color="blue">远端匹配 {reconciliation.discoveredCount}</Tag>
        <Tag color="green">已登记 {reconciliation.registeredCount}</Tag>
        <Tag color="default">未登记 {reconciliation.unregisteredCount}</Tag>
      </Space>
      {reconciliation.jobs.length === 0 ? <Empty description="此环境尚未登记白名单 Job" /> : <Table
        size="small"
        pagination={false}
        rowKey="jobKey"
        dataSource={reconciliation.jobs}
        columns={[
          { title: 'Job', dataIndex: 'jobName' },
          { title: '远端存在', dataIndex: 'exists', render: (value) => value ? <Tag color="success">是</Tag> : <Tag color="error">否</Tag> },
          { title: 'Buildable', dataIndex: 'buildable', render: (value) => value ? '是' : '否' },
          { title: '参数契约', dataIndex: ['schema', 'matches'], render: (value) => value ? <Tag color="success">一致</Tag> : <Tag color="error">不一致</Tag> },
        ]}
      />}
    </Card>}
  </Space>;
};

export default CicdCatalogPage;
