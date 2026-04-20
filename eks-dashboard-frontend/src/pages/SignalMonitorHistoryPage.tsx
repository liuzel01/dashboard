import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tag } from 'antd';
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
    } catch (e: any) {
      setError(e?.message || '加载 history 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns: ColumnsType<TriggerRow> = [
    { title: 'Event Time', dataIndex: 'event_time', key: 'event_time' },
    { title: 'Symbol', dataIndex: 'symbol', key: 'symbol' },
    { title: 'TF', dataIndex: 'timeframe', key: 'timeframe' },
    { title: 'Rule', dataIndex: 'rule', key: 'rule' },
    { title: 'Direction', dataIndex: 'direction', key: 'direction' },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'default'}>{v}</Tag>,
    },
    {
      title: 'Emitted',
      dataIndex: 'emitted',
      key: 'emitted',
      render: (v: boolean) => (v ? <Tag color="green">true</Tag> : <Tag color="default">false</Tag>),
    },
    { title: 'Suppressed Reason', dataIndex: 'suppressed_reason', key: 'suppressed_reason' },
    { title: 'Dedupe Key', dataIndex: 'dedupe_key', key: 'dedupe_key', ellipsis: true },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Space wrap>
        <Input
          placeholder="symbol"
          style={{ width: 120 }}
          value={query.symbol}
          onChange={(e) => setQuery((q) => ({ ...q, symbol: e.target.value || undefined }))}
        />
        <Input
          placeholder="rule"
          style={{ width: 120 }}
          value={query.rule}
          onChange={(e) => setQuery((q) => ({ ...q, rule: e.target.value || undefined }))}
        />
        <Select
          placeholder="timeframe"
          allowClear
          style={{ width: 120 }}
          value={query.timeframe}
          onChange={(v) => setQuery((q) => ({ ...q, timeframe: v || undefined }))}
          options={[{ label: '15m', value: '15m' }, { label: '1h', value: '1h' }]}
        />
        <Select
          placeholder="priority"
          allowClear
          style={{ width: 120 }}
          value={query.priority}
          onChange={(v) => setQuery((q) => ({ ...q, priority: v || undefined }))}
          options={[{ label: 'high', value: 'high' }, { label: 'medium', value: 'medium' }, { label: 'low', value: 'low' }]}
        />
        <Button onClick={() => load({ ...query, page: 1 })} loading={loading}>查询</Button>
      </Space>

      <Table<TriggerRow>
        rowKey={(r) => `${r.event_time}:${r.dedupe_key}`}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: query.page,
          pageSize: query.pageSize,
          total,
          showSizeChanger: true,
          onChange: (page, pageSize) => load({ ...query, page, pageSize }),
        }}
      />
    </Space>
  );
};

export default SignalMonitorHistoryPage;
