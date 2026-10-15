import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { createDependencyHealthTarget, deleteDependencyHealthTarget, getDependencyHealth, getDependencyHealthHistory, listDependencyHealthProviderProfiles, listDependencyHealthTargets, updateDependencyHealthTarget, verifyDependencyHealthTarget, type DependencyHealthHistory, type DependencyHealthItem, type DependencyHealthLayer, type DependencyHealthProviderProfile, type DependencyHealthResponse, type DependencyHealthTarget } from '../services/api';
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
  const [history, setHistory] = useState<DependencyHealthHistory | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targets, setTargets] = useState<DependencyHealthTarget[]>([]);
  const [providerProfiles, setProviderProfiles] = useState<DependencyHealthProviderProfile[]>([]);
  const [editingTarget, setEditingTarget] = useState<DependencyHealthTarget | null>(null);
  const [targetEditorOpen, setTargetEditorOpen] = useState(false);
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetVerifying, setTargetVerifying] = useState<string | null>(null);
  const [targetForm] = Form.useForm();
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
    if (!selectedItem) { setHistory(null); return; }
    void getDependencyHealthHistory(selectedItem.key, 24).then(setHistory).catch(() => setHistory(null));
  }, [selectedItem]);

  const openTargets = async () => {
    const [loadedTargets, loadedProfiles] = await Promise.all([listDependencyHealthTargets(), listDependencyHealthProviderProfiles()]);
    setTargets(loadedTargets);
    setProviderProfiles(loadedProfiles);
    setTargetsOpen(true);
  };
  const editTarget = (target?: DependencyHealthTarget) => {
    setEditingTarget(target || null);
    targetForm.setFieldsValue(target || { environmentId: 'global', category: 'external-api', module: 'http_2xx', enabled: true, sortOrder: 0 });
    setTargetEditorOpen(true);
  };
  const saveTarget = async (verify = false) => {
    const value = await targetForm.validateFields();
    setTargetSaving(true);
    try {
      const saved = editingTarget ? await updateDependencyHealthTarget(editingTarget.key, value) : await createDependencyHealthTarget(value);
      if (verify) await verifyDependencyHealthTarget(saved.key || editingTarget?.key);
      setTargets(await listDependencyHealthTargets());
      setEditingTarget(null);
      setTargetEditorOpen(false);
      targetForm.resetFields();
      await load('manual');
    } finally { setTargetSaving(false); }
  };

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
    {
      title: '依赖', dataIndex: 'name', key: 'name', width: 230, fixed: 'left' as const, ellipsis: true,
      render: (value: string) => <Tooltip title={value}><Typography.Text strong ellipsis style={{ display: 'block' }}>{value}</Typography.Text></Tooltip>,
    },
    {
      title: '所属环境',
      dataIndex: 'environmentId',
      key: 'environmentId',
      width: 130,
      filters: environmentFilters,
      onFilter: (value: React.Key | boolean, row: DependencyHealthItem) => row.environmentId === value,
      render: (value: string) => value === 'global'
        ? <Tag color="blue">全局</Tag>
        : <Typography.Text code>{value}</Typography.Text>,
    },
    { title: '类型', dataIndex: 'category', key: 'category', width: 150, ellipsis: true, render: (value: string) => <Tag>{value}</Tag> },
    {
      title: '状态', dataIndex: 'overallStatus', key: 'overallStatus', width: 120,
      render: (value: DependencyHealthItem['overallStatus']) => <Tooltip title={overallLabels[value].detail}><Tag color={overallLabels[value].color}>{overallLabels[value].text}</Tag></Tooltip>,
    },
    { title: '验证深度', dataIndex: 'verificationDepth', key: 'verificationDepth', width: 100, render: (value: DependencyHealthItem['verificationDepth']) => <Tag color={value === 'L1' ? 'default' : value === 'L2' ? 'blue' : 'purple'}>{value}</Tag> },
    { title: 'HTTP', dataIndex: 'httpStatus', key: 'httpStatus', width: 90, render: (value: number | null) => value ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', key: 'durationMs', width: 100, render: (value: number | null) => value === null ? '-' : `${value} ms` },
    { title: '探测目标', dataIndex: 'url', key: 'url', width: 360, ellipsis: true, render: (value: string) => <Tooltip title={value}><Typography.Text ellipsis style={{ display: 'block' }}>{value}</Typography.Text></Tooltip> },
    { title: '操作', key: 'actions', width: 90, fixed: 'right' as const, align: 'center' as const, render: (_: unknown, row: DependencyHealthItem) => <Button type="link" onClick={() => setSelectedItem(row)}>详情</Button> },
  ], [environmentFilters, environmentNameById]);

  return <>
    <PageHeader
      title="外部依赖健康"
      description="统一展示受控外部依赖的综合状态：L1 检查网络与 HTTP，L2 验证专用身份，L3 执行无副作用业务检查；每项依赖只执行其所需的最高验证深度。"
      actions={<Space>
        {backgroundRefreshing && <Typography.Text type="secondary"><SyncOutlined spin /> 后台更新中</Typography.Text>}
        {data?.stale && <Tag color="orange">显示上次成功结果</Tag>}
        {data?.checkedAt && <Typography.Text type="secondary">最后更新：{new Date(data.checkedAt).toLocaleTimeString()}</Typography.Text>}
        <Button icon={<SettingOutlined />} onClick={() => void openTargets()}>目标管理</Button>
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
    <OpsTable
      rowKey="key"
      loading={initialLoading && !data}
      columns={columns as any}
      dataSource={data?.items || []}
      tableLayout="fixed"
      scroll={{ x: 1370 }}
      pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items` }}
    />
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
        { key: 'availability', label: '近 24 小时可用率', children: <Space direction="vertical" style={{ width: '100%' }}>{(history?.availability || []).map((item) => <div key={item.layer}><Typography.Text>{item.layer}：{item.percentage ?? '-'}%</Typography.Text><Progress percent={item.percentage || 0} size="small" status={(item.percentage || 0) >= 99 ? 'success' : 'exception'} /></div>)}</Space> },
        { key: 'trend', label: '历史趋势', children: <Space wrap size={2}>{(history?.points || []).slice(-80).map((point, index) => <span key={`${point.checkedAt}-${index}`} title={`${point.layer} ${point.status} ${new Date(point.checkedAt).toLocaleString()}`} style={{ width: 7, height: 22, display: 'inline-block', borderRadius: 2, background: point.status === 'PASS' ? '#52c41a' : point.status === 'FAIL' ? '#ff4d4f' : '#faad14' }} />)}</Space> },
        { key: 'events', label: '告警与恢复', children: history?.events.length ? <Space direction="vertical">{history.events.map((event, index) => <Typography.Text key={`${event.createdAt}-${index}`} type={event.eventType === 'FIRING' ? 'danger' : 'success'}>{new Date(event.createdAt).toLocaleString()} [{event.layer}] {event.summary}</Typography.Text>)}</Space> : '近 24 小时无事件' },
      ]} />}
    </Modal>
    <Modal title="依赖目标管理" open={targetsOpen} onCancel={() => { setTargetsOpen(false); setEditingTarget(null); }} footer={null} width={1000}>
      <Button type="primary" style={{ marginBottom: 12 }} onClick={() => editTarget()}>新增目标</Button>
      <OpsTable rowKey="key" pagination={false} dataSource={targets} columns={[
        { title: '标识', dataIndex: 'key' }, { title: '名称', dataIndex: 'name' }, { title: '环境', dataIndex: 'environmentId' },
        { title: '模块', dataIndex: 'module', render: (value: string) => <Tag>{value}</Tag> },
        { title: 'Provider 配置', dataIndex: 'providerProfile', render: (value: string | null) => value ? <Tag color="blue">{providerProfiles.find((profile) => profile.id === value)?.label || value}</Tag> : '-' },
        { title: '状态', dataIndex: 'enabled', render: (value: boolean) => <Tag color={value ? 'success' : 'default'}>{value ? '启用' : '停用'}</Tag> },
        { title: '操作', render: (_: unknown, row: DependencyHealthTarget) => <Space><Button type="link" loading={targetVerifying === row.key} onClick={async () => { setTargetVerifying(row.key); try { await verifyDependencyHealthTarget(row.key); await load('manual'); } finally { setTargetVerifying(null); } }}>立即验证</Button><Button type="link" onClick={() => editTarget(row)}>编辑</Button><Popconfirm title="确认删除此目标？" onConfirm={async () => { await deleteDependencyHealthTarget(row.key); setTargets(await listDependencyHealthTargets()); await load('manual'); }}><Button type="link" danger>删除</Button></Popconfirm></Space> },
      ] as any} />
      <Modal title={editingTarget ? `编辑 ${editingTarget.name}` : '新增依赖目标'} open={targetEditorOpen} onCancel={() => { setTargetEditorOpen(false); setEditingTarget(null); targetForm.resetFields(); }} onOk={() => void saveTarget()} confirmLoading={targetSaving} okText="仅保存" destroyOnHidden footer={(_, { OkBtn, CancelBtn }) => <Space><CancelBtn /><Button loading={targetSaving} onClick={() => void saveTarget(true)}>保存并立即验证</Button><OkBtn /></Space>}>
        <Form form={targetForm} layout="vertical">
          {!editingTarget && <Form.Item name="key" label="内部标识" rules={[{ required: true }, { pattern: /^[a-z0-9][a-z0-9._-]{1,63}$/, message: '仅允许小写字母、数字、点、下划线和短横线' }]}><Input /></Form.Item>}
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="environmentId" label="所属环境" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={[{ value: 'global', label: '全局' }, ...environments.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))]} /></Form.Item>
          <Form.Item name="category" label="类型" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="url" label="探测 URL" rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item>
          <Form.Item name="module" label="L1 探测模块" rules={[{ required: true }]}><Select options={[{ value: 'http_2xx', label: 'HTTP 2xx' }, { value: 'http_reachable', label: 'HTTP 可达' }]} /></Form.Item>
          <Form.Item name="providerProfile" label="L2/L3 Provider 配置（可选）" extra="选择后由服务端读取 SiteConf 的对应专用凭据并执行只读检查；浏览器不会接收凭据值。不选择时仍按普通 L1 URL 探测。">
            <Select allowClear showSearch optionFilterProp="label" placeholder="不启用 Provider 专用检查" onChange={(value) => {
              const profile = providerProfiles.find((item) => item.id === value);
              if (profile) targetForm.setFieldsValue({ category: profile.category, url: profile.suggestedUrl || undefined, environmentId: profile.environmentId });
            }} options={providerProfiles.map((profile) => ({ value: profile.id, label: `${profile.label}（${profile.configured ? '已配置' : '未完整配置'}）`, title: profile.description }))} />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序"><InputNumber min={0} /></Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </Modal>
  </>;
};

export default DependencyHealthPage;
