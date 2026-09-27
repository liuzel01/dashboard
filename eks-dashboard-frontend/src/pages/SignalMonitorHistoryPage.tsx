import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tag, Empty, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getSignalMonitorTriggers24h } from '../services/signalMonitorApi';
import type { TriggerRow, Triggers24hParams } from '../services/signalMonitorApi';

const SignalMonitorHistoryPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TriggerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState<Triggers24hParams>({ page: 1, pageSize: 20 });

  const load = async (next = query) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSignalMonitorTriggers24h(next);
      setRows(data.items || []);
      setTotal(data.total || 0);
      setQuery({ ...next, page: data.page, pageSize: data.pageSize });
    } catch (e: unknown) {
      setError((e as ApiError)?.message || '加载 history 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns: ColumnsType<TriggerRow> = [
    { title: '触发时间（UTC）', dataIndex: 'event_time', key: 'event_time' },
    { title: '交易对', dataIndex: 'symbol', key: 'symbol' },
    { title: '周期', dataIndex: 'timeframe', key: 'timeframe' },
    { title: '规则', dataIndex: 'rule', key: 'rule' },
    { title: '方向(v0.1)', dataIndex: 'direction', key: 'direction' },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'default'}>{v}</Tag>,
    },
    { title: 'v0.1信号数', dataIndex: 'v01_signal_count', key: 'v01_signal_count', render: (v?: number) => v ?? '-' },
    {
      title: 'v0.2方向',
      dataIndex: 'v02_direction',
      key: 'v02_direction',
      render: (v?: string) => v || '-',
    },
    {
      title: 'v0.2分数',
      dataIndex: 'v02_score',
      key: 'v02_score',
      render: (v?: number) => (typeof v === 'number' ? v.toFixed(2) : '-'),
    },
    {
      title: 'v0.2置信度',
      dataIndex: 'v02_confidence',
      key: 'v02_confidence',
      render: (v?: 'low' | 'medium' | 'high') => {
        if (!v) return '-';
        const color = v === 'high' ? 'green' : v === 'medium' ? 'gold' : 'default';
        return <Tag color={color}>{v}</Tag>;
      },
    },
    {
      title: 'v0.2建议发送',
      dataIndex: 'v02_should_emit',
      key: 'v02_should_emit',
      render: (v?: boolean) => {
        if (typeof v !== 'boolean') return '-';
        return v ? <Tag color="green">是</Tag> : <Tag>否</Tag>;
      },
    },
    {
      title: '是否发送(v0.1链路)',
      dataIndex: 'emitted',
      key: 'emitted',
      render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag color="default">否</Tag>),
    },
    { title: '抑制原因', dataIndex: 'suppressed_reason', key: 'suppressed_reason', render: (v?: string | null) => v || '-' },
    { title: '去重键', dataIndex: 'dedupe_key', key: 'dedupe_key', ellipsis: true },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Space wrap>
        <Input
          placeholder="交易对"
          style={{ width: 120 }}
          value={query.symbol}
          onChange={(e) => setQuery((q) => ({ ...q, symbol: e.target.value || undefined }))}
        />
        <Input
          placeholder="规则"
          style={{ width: 120 }}
          value={query.rule}
          onChange={(e) => setQuery((q) => ({ ...q, rule: e.target.value || undefined }))}
        />
        <Select
          placeholder="周期"
          allowClear
          style={{ width: 120 }}
          value={query.timeframe}
          onChange={(v) => setQuery((q) => ({ ...q, timeframe: v || undefined }))}
          options={[{ label: '15m', value: '15m' }, { label: '1h', value: '1h' }]}
        />
        <Select
          placeholder="优先级"
          allowClear
          style={{ width: 120 }}
          value={query.priority}
          onChange={(v) => setQuery((q) => ({ ...q, priority: v || undefined }))}
          options={[{ label: '高', value: 'high' }, { label: '中', value: 'medium' }, { label: '低', value: 'low' }]}
        />
        <Button onClick={() => load({ ...query, page: 1 })} loading={loading}>查询</Button>
        <Button onClick={() => {
          const reset = { page: 1, pageSize: 20 } as Triggers24hParams;
          setQuery(reset);
          load(reset);
        }}>重置</Button>
      </Space>

      <Table<TriggerRow>
        rowKey={(r) => `${r.event_time}:${r.dedupe_key}`}
        loading={loading}
        columns={columns}
        dataSource={rows}
        expandable={{
          expandedRowRender: (record) => {
            const breakdown = record.v02_breakdown || [];
            if (!breakdown.length) return <span>-</span>;
            return (
              <Space direction="vertical" style={{ width: '100%' }}>
                {breakdown.map((b, idx) => (
                  <div key={`${record.dedupe_key}:${idx}`}>
                    <Tooltip title={b.reason}>
                      <Tag>{b.factor}</Tag>
                    </Tooltip>
                    <span> bullish: {b.weightedBullish.toFixed(2)} </span>
                    <span> bearish: {b.weightedBearish.toFixed(2)} </span>
                    <span style={{ color: '#999' }}>reason: {b.reason}</span>
                  </div>
                ))}
              </Space>
            );
          },
          rowExpandable: (record) => !!record.v02_breakdown?.length,
        }}
        locale={{ emptyText: <Empty description="近24小时无触发记录" /> }}
        pagination={{
          current: query.page,
          pageSize: query.pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, pageSize) => load({ ...query, page, pageSize }),
        }}
      />
    </Space>
  );
};

export default SignalMonitorHistoryPage;
