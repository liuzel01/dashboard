import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Empty, Select, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { AuthContext } from '../contexts/AuthContextValue';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import {
  diagnoseCicdExecutor,
  discoverCicdJobs,
  getCicdDiscoveredJobDetail,
  getCicdEnvironmentBindings,
  getCicdExecutors,
  reconcileCicdCatalog,
  type CicdActionType,
  type CicdDiscoveredJob,
  type CicdDiscoveredJobDetail,
  type CicdEnvironmentBinding,
  type CicdExecutor,
  type CicdExecutorDiagnostic,
  type CicdReconciliation,
} from '../services/api';

const { Text, Title } = Typography;
const actionOptions = [
  { value: 'BUILD_DEPLOY', label: '构建部署' },
  { value: 'PACKAGE_PUBLISH', label: '制品推包' },
] as const;

const errorMessage = (error: unknown, fallback: string) =>
  (error as ApiError)?.response?.data?.message || (error as ApiError)?.message || fallback;

const CicdCatalogPage: React.FC = () => {
  const { message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const { permissions } = useContext(AuthContext);
  const canManage = permissions.includes('cicd-config:manage');
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
    try { setSelectedJob(await getCicdDiscoveredJobDetail(currentEnvironment.id, actionType, jobName)); }
    catch (error) { message.error(errorMessage(error, 'Jenkins Job 参数加载失败')); }
    finally { setLoading(false); }
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
      <Text type="secondary">Phase 1 仅提供受控 Job 目录、连接检查和参数对账，不会触发 Jenkins 构建。</Text>
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
      : <Card title="执行器绑定" extra={<Tag color="blue">只读阶段</Tag>}>
          <Descriptions size="small" column={{ xs: 1, md: 2, lg: 3 }}>
            <Descriptions.Item label="Executor">{binding.executor_display_name || binding.executor_key}</Descriptions.Item>
            <Descriptions.Item label="Provider">{binding.provider_type}</Descriptions.Item>
            <Descriptions.Item label="Job 发现范围">{filterMode === 'ALL' ? <Tag color="blue">全部可读 Job</Tag> : <Text code>{binding.job_name_pattern}</Text>}</Descriptions.Item>
            <Descriptions.Item label="连接配置">{executor?.configured ? <Tag color="success">已配置</Tag> : <Tag color="warning">未配置</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Jenkins Host">{executor?.host || '-'}</Descriptions.Item>
            <Descriptions.Item label="目录数量">{jobs.length}</Descriptions.Item>
          </Descriptions>
          <Space style={{ marginTop: 16 }}>
            <Button icon={<SafetyCertificateOutlined />} loading={diagnosing} disabled={!canManage || !executor?.configured} onClick={runDiagnostic}>连接检查</Button>
            <Button icon={<ReloadOutlined />} loading={reconciling} disabled={!canManage || !executor?.configured} onClick={runReconciliation}>Job / 参数对账</Button>
            {!canManage && <Text type="secondary">需要 cicd-config:manage 权限</Text>}
          </Space>
        </Card>}

    {selectedJob && <Card title="Job 参数契约">
      <Descriptions size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Jenkins Job"><Text code>{selectedJob.name}</Text></Descriptions.Item>
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
    </Card>}

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
