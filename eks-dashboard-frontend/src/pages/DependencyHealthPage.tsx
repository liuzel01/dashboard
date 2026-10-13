import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { getDependencyHealth, type DependencyHealthItem, type DependencyHealthLayer, type DependencyHealthResponse } from '../services/api';
import { MetricGrid, OpsTable, PageHeader } from '../components/ops';

const moduleLabel = (item: DependencyHealthItem) => item.module === 'http_reachable'
  ? 'HTTP 可达性（允许预先核定的认证或业务错误状态码）'
  : 'HTTP 成功响应（2xx）';

const overallLabels: Record<DependencyHealthItem['overallStatus'], { text: string; color: string; detail: string }> = {
  HEALTHY: { text: '健康', color: 'success', detail: '已通过当前依赖要求的全部检查' },
  REACHABLE: { text: '可达', color: 'success', detail: '网络与 HTTP 可达；该依赖当前只要求 L1' },
  UNAVAILABLE: { text: '不可用', color: 'error', detail: '网络、TLS、HTTP 或 Provider 请求失败' },
  AUTH_FAILED: { text: '认证失败', color: 'error', detail: '专用凭据无法通过 Provider 认证' },
  PERMISSION_DENIED: { text: '权限不足', color: 'error', detail: '专用身份缺少只读检查权限' },
  BUSINESS_FAILED: { text: '业务检查失败', color: 'error', detail: '认证正常，但无副作用业务检查未通过' },
  NOT_CONFIGURED: { text: '未配置', color: 'warning', detail: '该依赖尚未完成专用凭据或检查目标配置' },
  CHECKING: { text: '检查中', color: 'processing', detail: '后台尚未产生该层检查结果' },
  STALE: { text: '结果过期', color: 'warning', detail: '后台检查结果超过允许时间，不能继续视为健康' },
};

const layerTag = (layer?: DependencyHealthLayer) => {
  if (!layer) return <Tag>待检查</Tag>;
  const color = layer.status === 'PASS' ? 'success' : layer.status === 'NOT_CONFIGURED' ? 'warning' : layer.status === 'SKIPPED' ? 'default' : 'error';
  const text = layer.status === 'PASS' ? '通过' : layer.status === 'NOT_CONFIGURED' ? '未配置' : layer.status === 'SKIPPED' ? '已跳过' : '失败';
  return <Space><Tag color={color}>{text}</Tag><Typography.Text>{layer.summary}</Typography.Text></Space>;
};

const DependencyHealthPage: React.FC = () => {
  const { environments } = useContext(EnvironmentContext);
  const [data, setData] = useState<DependencyHealthResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DependencyHealthItem | null>(null);
  const requestInFlight = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'background' | 'manual') => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (mode === 'initial') setInitialLoading(true);
    if (mode === 'background') setBackgroundRefreshing(true);
    if (mode === 'manual') setManualRefreshing(true);
    setError(null);
    try { setData(await getDependencyHealth(mode === 'manual')); }
    catch (reason: any) { setError(reason?.response?.data?.message || reason?.message || '加载外部依赖健康状态失败'); }
    finally {
      requestInFlight.current = false;
      if (mode === 'initial') setInitialLoading(false);
      if (mode === 'background') setBackgroundRefreshing(false);
      if (mode === 'manual') setManualRefreshing(false);
    }
  }, []);

  useEffect(() => { void load('initial'); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load('background');
    }, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load('background');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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
    { title: '状态', dataIndex: 'overallStatus', key: 'overallStatus', render: (value: DependencyHealthItem['overallStatus']) => <Space><Tag color={overallLabels[value].color}>{overallLabels[value].text}</Tag><Typography.Text type="secondary">{overallLabels[value].detail}</Typography.Text></Space> },
    { title: '验证深度', dataIndex: 'verificationDepth', key: 'verificationDepth', width: 100, render: (value: DependencyHealthItem['verificationDepth']) => <Tag color={value === 'L1' ? 'default' : value === 'L2' ? 'blue' : 'purple'}>{value}</Tag> },
    { title: 'HTTP', dataIndex: 'httpStatus', key: 'httpStatus', width: 90, render: (value: number | null) => value ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100, render: (value: number | null) => value === null ? '-' : `${value} ms` },
    { title: '探测目标', dataIndex: 'url', key: 'url', ellipsis: true },
    { title: '检查时间', dataIndex: 'checkedAt', key: 'checkedAt', width: 190, render: (value: string) => new Date(value).toLocaleString() },
    { title: '操作', key: 'actions', width: 80, render: (_: unknown, row: DependencyHealthItem) => <Button type="link" onClick={() => setSelectedItem(row)}>详情</Button> },
  ], [environmentFilters, environmentNameById]);

  return <>
    <PageHeader
      title="外部依赖健康"
      description="统一展示受控外部依赖的综合状态：L1 检查网络与 HTTP，L2 验证专用身份，L3 执行无副作用业务检查；每项依赖只执行其所需的最高验证深度。"
      actions={<Space>
        {backgroundRefreshing && <Typography.Text type="secondary"><SyncOutlined spin /> 后台更新中</Typography.Text>}
        {data?.stale && <Tag color="orange">显示上次成功结果</Tag>}
        {data?.checkedAt && <Typography.Text type="secondary">最后更新：{new Date(data.checkedAt).toLocaleTimeString()}</Typography.Text>}
        <Button icon={<ReloadOutlined />} loading={manualRefreshing} disabled={backgroundRefreshing} onClick={() => void load('manual')}>刷新</Button>
      </Space>}
    />
    {error && <Alert type={data ? 'warning' : 'error'} showIcon message={data ? '后台更新失败，继续显示上次结果' : '外部依赖健康加载失败'} description={error} style={{ marginBottom: 16 }} />}
    <MetricGrid items={[
      { key: 'total', label: '受控依赖', value: data?.summary.total ?? 0 },
      { key: 'healthy', label: '正常', value: data?.summary.healthy ?? 0, valueStyle: { color: '#389e0d' } },
      { key: 'unhealthy', label: '异常', value: data?.summary.unhealthy ?? 0, valueStyle: (data?.summary.unhealthy || 0) > 0 ? { color: '#cf1322' } : undefined },
      { key: 'checking', label: '检查中', value: data?.summary.checking ?? 0 },
    ]} />
    <OpsTable rowKey="key" loading={initialLoading && !data} columns={columns as any} dataSource={data?.items || []} pagination={false} />
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
        { key: 'status', label: '综合状态', children: <Tag color={overallLabels[selectedItem.overallStatus].color}>{overallLabels[selectedItem.overallStatus].text}</Tag> },
        { key: 'depth', label: '验证深度', children: selectedItem.verificationDepth },
        { key: 'l1', label: 'L1 网络/HTTP', children: layerTag(selectedItem.layers.L1) },
        ...(selectedItem.verificationDepth !== 'L1' ? [
          { key: 'l2', label: 'L2 专用身份', children: layerTag(selectedItem.layers.L2) },
          { key: 'l3', label: 'L3 无副作用业务', children: layerTag(selectedItem.layers.L3) },
        ] : []),
        { key: 'http', label: 'HTTP 状态码', children: selectedItem.httpStatus ?? '-' },
        { key: 'duration', label: '响应耗时', children: selectedItem.durationMs === null ? '-' : `${selectedItem.durationMs} ms` },
        { key: 'tls', label: 'TLS 证书到期', children: selectedItem.tlsExpiresAt ? new Date(selectedItem.tlsExpiresAt).toLocaleString() : '-' },
        { key: 'checkedAt', label: '检查时间', children: new Date(selectedItem.checkedAt).toLocaleString() },
      ]} />}
    </Modal>
  </>;
};

export default DependencyHealthPage;
