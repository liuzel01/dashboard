import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Input, Select, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RobotOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { listAiOpsInvestigations, type AiOpsInvestigation } from '../services/api';
import { FilterBar, MetricGrid, OpsTable, PageHeader, StatusBadge } from '../components/ops';

const AiOpsWorkbenchPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [items, setItems] = useState<AiOpsInvestigation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const keywordRef = useRef('');

  const load = useCallback(async () => {
    if (!currentEnvironment?.id) return;
    setLoading(true); setError(null);
    try {
      const result = await listAiOpsInvestigations(currentEnvironment.id, { status, keyword: keywordRef.current.trim() || undefined, pageSize: 100 });
      setItems(result.items); setTotal(result.total);
    } catch (err: unknown) {
      const text = (err as ApiError)?.response?.data?.message || (err as Error)?.message || 'AI 调查任务加载失败';
      setError(text); message.error(text);
    } finally { setLoading(false); }
  }, [currentEnvironment?.id, message, status]);

  useEffect(() => { setItems([]); setTotal(0); setError(null); setKeyword(''); keywordRef.current = ''; setStatus(undefined); }, [currentEnvironment?.id]);
  useEffect(() => { if (currentEnvironment?.id) void load(); }, [currentEnvironment?.id, load]);

  const metrics = useMemo(() => [
    { key: 'active', label: '调查中', value: items.filter((item) => ['PENDING', 'COLLECTING', 'ANALYZING'].includes(item.status)).length, valueStyle: { color: '#1677ff' } },
    { key: 'completed', label: '已完成', value: items.filter((item) => item.status === 'COMPLETED').length, valueStyle: { color: '#389e0d' } },
    { key: 'insufficient', label: '证据不足', value: items.filter((item) => Boolean(item.insufficient_evidence)).length, valueStyle: { color: '#d48806' } },
    { key: 'failed', label: '失败', value: items.filter((item) => item.status === 'FAILED').length, valueStyle: { color: '#cf1322' } },
  ], [items]);

  const columns: ColumnsType<AiOpsInvestigation> = [
    { title: '状态', dataIndex: 'status', width: 120, render: (value) => <StatusBadge status={value} /> },
    { title: '告警', dataIndex: 'alert_name', render: (value, row) => <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/ai-ops/investigations/${row.id}`)}>{value || `调查 #${row.id}`}</Button> },
    { title: '级别', dataIndex: 'severity', width: 90, render: (value) => value ? <Tag color={value === 'critical' ? 'red' : value === 'warning' ? 'gold' : 'blue'}>{value}</Tag> : '-' },
    { title: '服务 / Pod', width: 260, render: (_, row) => row.service_name || row.resource_name || '-' },
    { title: '分类', dataIndex: 'classification', width: 180, render: (value) => value ? <Tag>{value}</Tag> : '-' },
    { title: '摘要', dataIndex: 'summary', ellipsis: true },
    { title: '开始时间', dataIndex: 'source_started_at', width: 180 },
  ];

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <PageHeader title={<Space><RobotOutlined />AI 运维</Space>} description="以告警为入口，自动形成可追溯的初步调查报告；当前阶段只读，不执行生产处置。" environmentName={currentEnvironment?.name}
      actions={<Space><Button icon={<SearchOutlined />} onClick={() => navigate('/ai-ops/tools/logs')}>主动日志调查</Button><Button icon={<ToolOutlined />} onClick={() => navigate('/ai-ops/tools/sql')}>SQL 助手</Button></Space>} />
    <MetricGrid items={metrics} loading={loading} />
    <FilterBar actions={<Button type="primary" onClick={() => void load()} loading={loading}>查询</Button>}>
      <Select allowClear placeholder="调查状态" value={status} onChange={setStatus} style={{ width: 180 }} options={['PENDING', 'COLLECTING', 'ANALYZING', 'COMPLETED', 'INSUFFICIENT_EVIDENCE', 'FAILED'].map((value) => ({ value, label: value }))} />
      <Input value={keyword} onChange={(event) => { setKeyword(event.target.value); keywordRef.current = event.target.value; }} onPressEnter={() => void load()} placeholder="告警、服务、Namespace 或摘要" style={{ width: 320 }} />
      <Typography.Text type="secondary">共 {total} 条</Typography.Text>
    </FilterBar>
    <OpsTable rowKey="id" columns={columns} dataSource={items} loading={loading} pagination={false} error={error} onRetry={() => void load()} scroll={{ x: 1100 }} />
  </Space>;
};

export default AiOpsWorkbenchPage;
