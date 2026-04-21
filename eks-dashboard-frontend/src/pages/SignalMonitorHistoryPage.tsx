import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tag, Empty } from 'antd';
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
    { title: '触发时间', dataIndex: 'event_time', key: 'event_time' },
    { title: '交易对', dataIndex: 'symbol', key: 'symbol' },
    { title: '周期', dataIndex: 'timeframe', key: 'timeframe' },
    { title: '规则', dataIndex: 'rule', key: 'rule' },
    { title: '方向', dataIndex: 'direction', key: 'direction' },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'default'}>{v}</Tag>,
    },
    {
      title: '是否发送',
      dataIndex: 'emitted',
      key: 'emitted',
      render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag color="default">否</Tag>),
    },
    { title: '抑制原因', dataIndex: 'suppressed_reason', key: 'suppressed_reason' },
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
