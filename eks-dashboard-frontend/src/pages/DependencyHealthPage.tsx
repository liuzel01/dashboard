import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { getDependencyHealth, type DependencyHealthItem, type DependencyHealthResponse } from '../services/api';
import { MetricGrid, OpsTable, PageHeader } from '../components/ops';

const errorLabel: Record<DependencyHealthItem['errorType'], string> = {
  NONE: '正常',
  NETWORK: '网络或TLS失败',
  HTTP_STATUS: 'HTTP状态异常',
  PROBE_ERROR: '探测器不可用',
};

const healthyLabel = (item: DependencyHealthItem) => item.module === 'http_reachable' ? '可达' : '健康';
const moduleLabel = (item: DependencyHealthItem) => item.module === 'http_reachable'
  ? 'HTTP 可达性（允许预先核定的认证或业务错误状态码）'
  : 'HTTP 成功响应（2xx）';

const DependencyHealthPage: React.FC = () => {
  const { environments } = useContext(EnvironmentContext);
  const [data, setData] = useState<DependencyHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DependencyHealthItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await getDependencyHealth()); }
    catch (reason: any) { setError(reason?.response?.data?.message || reason?.message || '加载外部依赖健康状态失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const environmentNameById = useMemo(
    () => new Map(environments.map((environment) => [environment.id, environment.name])),
    [environments],
  );

  const environmentFilters = useMemo(
    () => Array.from(new Set((data?.items || []).map((item) => item.environmentId)))
      .sort((left, right) => left === 'global' ? -1 : right === 'global' ? 1 : left.localeCompare(right))
      .map((environmentId) => ({
        text: environmentId === 'global'
          ? '全局'
          : `${environmentNameById.get(environmentId) || environmentId} (${environmentId})`,
        value: environmentId,
      })),
    [data?.items, environmentNameById],
  );

  const columns = useMemo(() => [
    { title: '依赖', dataIndex: 'name', key: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    {
      title: '所属环境',
      dataIndex: 'environmentId',
      key: 'environmentId',
      width: 160,
      filters: environmentFilters,
      onFilter: (value: React.Key | boolean, row: DependencyHealthItem) => row.environmentId === value,
      render: (value: string) => value === 'global'
        ? <Tag color="blue">全局</Tag>
        : <Space direction="vertical" size={0}><Typography.Text>{environmentNameById.get(value) || value}</Typography.Text><Typography.Text type="secondary">{value}</Typography.Text></Space>,
    },
    { title: '类型', dataIndex: 'category', key: 'category', render: (value: string) => <Tag>{value}</Tag> },
    { title: '状态', dataIndex: 'healthy', key: 'healthy', render: (value: boolean, row: DependencyHealthItem) => <Space><Tag color={value ? 'success' : 'error'}>{value ? healthyLabel(row) : '异常'}</Tag>{!value && <Typography.Text type="secondary">{errorLabel[row.errorType]}</Typography.Text>}</Space> },
    { title: 'HTTP', dataIndex: 'httpStatus', key: 'httpStatus', width: 90, render: (value: number | null) => value ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100, render: (value: number | null) => value === null ? '-' : `${value} ms` },
    { title: '探测目标', dataIndex: 'url', key: 'url', ellipsis: true },
    { title: '检查时间', dataIndex: 'checkedAt', key: 'checkedAt', width: 190, render: (value: string) => new Date(value).toLocaleString() },
    { title: '操作', key: 'actions', width: 80, render: (_: unknown, row: DependencyHealthItem) => <Button type="link" onClick={() => setSelectedItem(row)}>详情</Button> },
  ], [environmentFilters, environmentNameById]);

  return <>
    <PageHeader
      title="外部依赖健康"
      description="从 Dashboard 所在网络位置统一探测所有环境的受控外部地址，每 60 秒自动刷新；本页只表示 DNS/TCP/TLS/HTTP 层健康，不代表 Provider 凭据和业务权限一定可用。"
      actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>}
    />
    {error && <Alert type="error" showIcon message="外部依赖健康加载失败" description={error} style={{ marginBottom: 16 }} />}
    <MetricGrid items={[
      { key: 'total', label: '受控依赖', value: data?.summary.total ?? 0 },
      { key: 'healthy', label: '正常', value: data?.summary.healthy ?? 0, valueStyle: { color: '#389e0d' } },
      { key: 'unhealthy', label: '异常', value: data?.summary.unhealthy ?? 0, valueStyle: (data?.summary.unhealthy || 0) > 0 ? { color: '#cf1322' } : undefined },
    ]} />
    <OpsTable rowKey="key" loading={loading} columns={columns as any} dataSource={data?.items || []} pagination={false} />
    <Modal
      title={selectedItem?.name || '依赖详情'}
      open={Boolean(selectedItem)}
      footer={null}
      onCancel={() => setSelectedItem(null)}
      width={720}
    >
      {selectedItem && <Descriptions bordered column={1} size="small" items={[
        { key: 'key', label: '内部标识', children: selectedItem.key },
        { key: 'environment', label: '所属环境', children: selectedItem.environmentId === 'global' ? '全局' : `${environmentNameById.get(selectedItem.environmentId) || selectedItem.environmentId} (${selectedItem.environmentId})` },
        { key: 'category', label: '依赖类型', children: selectedItem.category },
        { key: 'module', label: '探测方式', children: moduleLabel(selectedItem) },
        { key: 'url', label: '探测目标', children: <Typography.Text copyable>{selectedItem.url}</Typography.Text> },
        { key: 'status', label: '当前状态', children: selectedItem.healthy ? healthyLabel(selectedItem) : `异常（${errorLabel[selectedItem.errorType]}）` },
        { key: 'http', label: 'HTTP 状态码', children: selectedItem.httpStatus ?? '-' },
        { key: 'duration', label: '响应耗时', children: selectedItem.durationMs === null ? '-' : `${selectedItem.durationMs} ms` },
        { key: 'tls', label: 'TLS 证书到期', children: selectedItem.tlsExpiresAt ? new Date(selectedItem.tlsExpiresAt).toLocaleString() : '-' },
        { key: 'checkedAt', label: '检查时间', children: new Date(selectedItem.checkedAt).toLocaleString() },
      ]} />}
    </Modal>
  </>;
};

export default DependencyHealthPage;
