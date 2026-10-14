import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, RobotOutlined, SearchOutlined, SyncOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { getAiOpsQualitySummary, listAiOpsInvestigations, listAiOpsReplayCases, replayAiOpsCase, type AiOpsInvestigation, type AiOpsQualitySummary, type AiOpsReplayCase } from '../services/api';
import { FilterBar, MetricGrid, OpsTable, PageHeader, StatusBadge } from '../components/ops';

const AiOpsWorkbenchPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [items, setItems] = useState<AiOpsInvestigation[]>([]);
  const [total, setTotal] = useState(0);
  const [quality, setQuality] = useState<AiOpsQualitySummary>();
  const [initialLoading, setInitialLoading] = useState(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayCases, setReplayCases] = useState<AiOpsReplayCase[]>([]);
  const [selectedReplayCase, setSelectedReplayCase] = useState<string>();
  const [replayLoading, setReplayLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const keywordRef = useRef('');
  const requestInFlight = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'background' | 'manual', requestedPage = page, requestedPageSize = pageSize) => {
    if (!currentEnvironment?.id || requestInFlight.current) return;
    requestInFlight.current = true;
    if (mode === 'initial') setInitialLoading(true);
    if (mode === 'background') setBackgroundRefreshing(true);
    if (mode === 'manual') setManualRefreshing(true);
    setError(null);
    try {
      const [result, qualityResult] = await Promise.all([
        listAiOpsInvestigations(currentEnvironment.id, { status, keyword: keywordRef.current.trim() || undefined, page: requestedPage, pageSize: requestedPageSize }),
        getAiOpsQualitySummary(currentEnvironment.id),
      ]);
      setItems(result.items); setTotal(result.total);
      setQuality(qualityResult);
    } catch (err: unknown) {
      const text = (err as ApiError)?.response?.data?.message || (err as Error)?.message || 'AI 调查任务加载失败';
      setError(text);
      if (mode !== 'background') message.error(text);
    } finally {
      requestInFlight.current = false;
      if (mode === 'initial') setInitialLoading(false);
      if (mode === 'background') setBackgroundRefreshing(false);
      if (mode === 'manual') setManualRefreshing(false);
    }
  }, [currentEnvironment?.id, message, page, pageSize, status]);

  useEffect(() => { setItems([]); setTotal(0); setError(null); setKeyword(''); keywordRef.current = ''; setStatus(undefined); setPage(1); }, [currentEnvironment?.id]);
  useEffect(() => { if (currentEnvironment?.id) void load('initial'); }, [currentEnvironment?.id, load]);
  useEffect(() => {
    if (!currentEnvironment?.id) return;
    const refresh = () => { if (document.visibilityState === 'visible') void load('background'); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [currentEnvironment?.id, load]);

  const openReplay = async () => {
    if (!currentEnvironment?.id) return;
    setReplayLoading(true);
    try {
      const result = await listAiOpsReplayCases(currentEnvironment.id);
      setReplayCases(result.items);
      setSelectedReplayCase(result.items[0]?.key);
      setReplayOpen(true);
    } catch (err: unknown) {
      message.error((err as ApiError)?.response?.data?.message || '历史案例加载失败');
    } finally {
      setReplayLoading(false);
    }
  };

  const runReplay = async () => {
    if (!currentEnvironment?.id || !selectedReplayCase) return;
    setReplayLoading(true);
    try {
      const result = await replayAiOpsCase(currentEnvironment.id, selectedReplayCase);
      message.success(result.created ? '历史案例已生成调查' : '已刷新已有历史调查');
      setReplayOpen(false);
      await load('manual');
      navigate(`/ai-ops/investigations/${result.investigationId}`);
    } catch (err: unknown) {
      message.error((err as ApiError)?.response?.data?.message || '历史案例回放失败');
    } finally {
      setReplayLoading(false);
    }
  };

  const metrics = useMemo(() => [
    { key: 'active', label: '调查中', value: items.filter((item) => ['PENDING', 'COLLECTING', 'ANALYZING'].includes(item.status)).length, valueStyle: { color: '#1677ff' } },
    { key: 'completed', label: '已完成', value: items.filter((item) => item.status === 'COMPLETED').length, valueStyle: { color: '#389e0d' } },
    { key: 'insufficient', label: '证据不足', value: items.filter((item) => Boolean(item.insufficient_evidence)).length, valueStyle: { color: '#d48806' } },
    { key: 'failed', label: '失败', value: items.filter((item) => item.status === 'FAILED').length, valueStyle: { color: '#cf1322' } },
  ], [items]);

  const columns: ColumnsType<AiOpsInvestigation> = [
    { title: '告警', dataIndex: 'alert_name', width: 280, fixed: 'left', ellipsis: true, render: (value, row) => <Space size={6}><Typography.Text strong ellipsis style={{ maxWidth: 190 }}>{value || `调查 #${row.id}`}</Typography.Text>{row.source_type === 'HISTORICAL_REPLAY' && <Tag color="purple">历史回放</Tag>}</Space> },
    { title: '状态', dataIndex: 'status', width: 120, render: (value) => <StatusBadge status={value} /> },
    { title: '级别', dataIndex: 'severity', width: 90, render: (value) => value ? <Tag color={value === 'critical' ? 'red' : value === 'warning' ? 'gold' : 'blue'}>{value}</Tag> : '-' },
    { title: '服务 / Pod', width: 260, render: (_, row) => row.service_name || row.resource_name || '-' },
    { title: '分类', dataIndex: 'classification', width: 180, render: (value) => value ? <Tag>{value}</Tag> : '-' },
    { title: '摘要', dataIndex: 'summary', ellipsis: true },
    { title: '开始时间', dataIndex: 'source_started_at', width: 180 },
    { title: '操作', key: 'actions', width: 90, fixed: 'right', align: 'center', render: (_, row) => <Button type="link" onClick={() => navigate(`/ai-ops/investigations/${row.id}`)}>详情</Button> },
  ];

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <PageHeader title={<Space><RobotOutlined />AI 运维</Space>} description="以告警为入口，自动形成可追溯的初步调查报告；当前阶段只读，不执行生产处置。" environmentName={currentEnvironment?.name}
      actions={<Space>{backgroundRefreshing && <Typography.Text type="secondary"><SyncOutlined spin /> 后台更新中</Typography.Text>}<Button icon={<ReloadOutlined />} loading={manualRefreshing} disabled={backgroundRefreshing} onClick={() => void load('manual')}>刷新</Button><Button onClick={() => void openReplay()} loading={replayLoading}>历史案例回放</Button><Button icon={<SearchOutlined />} onClick={() => navigate('/ai-ops/tools/logs')}>主动日志调查</Button><Button icon={<ToolOutlined />} onClick={() => navigate('/ai-ops/tools/sql')}>SQL 助手</Button></Space>} />
    <MetricGrid items={metrics} loading={initialLoading && items.length === 0} />
    {quality && <Card size="small" title="质量概览"><Space wrap><Tag>调查 {Number(quality.overview.total || 0)}</Tag><Tag color="orange">证据不足 {Number(quality.overview.insufficient_evidence || 0)}</Tag><Tag color="purple">回放/合成 {Number(quality.overview.replay_count || 0) + Number(quality.overview.synthetic_count || 0)}</Tag>{quality.queue.map((item) => <Tag color={item.status === 'FAILED' ? 'red' : undefined} key={`queue-${item.status}`}>队列 {item.status}: {item.count}</Tag>)}{quality.evidenceCoverage.map((item) => <Tag key={item.source_system}>{item.source_system}: {item.investigation_count}</Tag>)}{quality.partialOrFailedSteps.map((item) => <Tag color="red" key={`${item.step_key}-${item.status}`}>{item.step_key} {item.status}: {item.count}</Tag>)}</Space></Card>}
    <FilterBar actions={<Button type="primary" onClick={() => { setPage(1); void load('manual', 1, pageSize); }} loading={manualRefreshing}>查询</Button>}>
      <Select allowClear placeholder="调查状态" value={status} onChange={(value) => { setStatus(value); setPage(1); }} style={{ width: 180 }} options={['PENDING', 'COLLECTING', 'ANALYZING', 'COMPLETED', 'INSUFFICIENT_EVIDENCE', 'FAILED'].map((value) => ({ value, label: value }))} />
      <Input value={keyword} onChange={(event) => { setKeyword(event.target.value); keywordRef.current = event.target.value; }} onPressEnter={() => { setPage(1); void load('manual', 1, pageSize); }} placeholder="告警、服务、Namespace 或摘要" style={{ width: 320 }} />
      <Typography.Text type="secondary">共 {total} 条</Typography.Text>
    </FilterBar>
    <OpsTable rowKey="id" columns={columns} dataSource={items} loading={initialLoading && items.length === 0} error={error} onRetry={() => void load('manual')} tableLayout="fixed" scroll={{ x: 1350 }} pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (count, range) => `${range[0]}-${range[1]} of ${count} items`, onChange: (nextPage, nextPageSize) => { setPage(nextPageSize === pageSize ? nextPage : 1); setPageSize(nextPageSize); } }} />
    <Modal title="历史案例回放" open={replayOpen} onCancel={() => setReplayOpen(false)} onOk={() => void runReplay()} okText="开始回放" confirmLoading={replayLoading} okButtonProps={{ disabled: !selectedReplayCase }}>
      {replayCases.length > 0 ? <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" showIcon message="历史回放不会创建当前 firing 告警，也不会触发 Oncall 或告警群通知。" />
        <Select value={selectedReplayCase} onChange={setSelectedReplayCase} style={{ width: '100%' }} options={replayCases.map((item) => ({ value: item.key, label: item.name }))} />
        {replayCases.filter((item) => item.key === selectedReplayCase).map((item) => <Typography.Text type="secondary" key={item.key}>{item.description} 期望分类：{item.expectedClassification}</Typography.Text>)}
      </Space> : <Alert type="warning" showIcon message={`环境 ${currentEnvironment?.name || '-'} 暂无可回放案例`} />}
    </Modal>
  </Space>;
};

export default AiOpsWorkbenchPage;
