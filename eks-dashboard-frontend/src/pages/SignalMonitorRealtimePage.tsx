import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Input, Row, Space, Table, Tag, Switch, Empty, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getSignalMonitorRealtime } from '../services/signalMonitorApi';
import type { RealtimeItem } from '../services/signalMonitorApi';

const SignalMonitorRealtimePage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RealtimeItem[]>([]);
  const [lastTs, setLastTs] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSignalMonitorRealtime();
      setRows(data.active || []);
      setLastTs(data.ts || '');
    } catch (e: any) {
      setError(e?.message || '加载 realtime 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const filteredRows = useMemo(() => {
    const kw = symbolFilter.trim().toUpperCase();
    if (!kw) return rows;
    return rows.filter((r) => r.symbol.toUpperCase().includes(kw));
  }, [rows, symbolFilter]);

  const highCount = useMemo(() => filteredRows.filter((r) => r.priority === 'high').length, [filteredRows]);
  const v02EmitCount = useMemo(() => filteredRows.filter((r) => r.v02_should_emit === true).length, [filteredRows]);

  const columns: ColumnsType<RealtimeItem> = [
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
    { title: '最新价格（USD）', dataIndex: 'latest_price', key: 'latest_price' },
    { title: '最近触发时间', dataIndex: 'latest_trigger_time', key: 'latest_trigger_time' },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Row gutter={16}>
        <Col span={6}>
          <Card title="活跃信号数">{filteredRows.length}</Card>
        </Col>
        <Col span={6}>
          <Card title="高优先级信号">{highCount}</Card>
        </Col>
        <Col span={6}>
          <Card title="v0.2建议发送数">{v02EmitCount}</Card>
        </Col>
        <Col span={6}>
          <Card title="最近刷新时间">{lastTs || '-'}</Card>
        </Col>
      </Row>

      <Space wrap>
        <Input
          placeholder="筛选交易对（如 BTC / BTCUSDT）"
          style={{ width: 260 }}
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          allowClear
        />
        <Button onClick={load} loading={loading}>刷新</Button>
        <span>自动刷新</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} />
      </Space>

      <Table<RealtimeItem>
        rowKey={(r) => `${r.symbol}:${r.timeframe}:${r.rule}:${r.direction}`}
        loading={loading}
        columns={columns}
        dataSource={filteredRows}
        pagination={{ pageSize: 20 }}
        expandable={{
          expandedRowRender: (record) => {
            const breakdown = record.v02_breakdown || [];
            if (!breakdown.length) return <span>-</span>;
            return (
              <Space direction="vertical" style={{ width: '100%' }}>
                {breakdown.map((b, idx) => (
                  <div key={`${record.symbol}:${record.timeframe}:${record.rule}:${idx}`}>
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
        locale={{ emptyText: <Empty description="暂无实时信号" /> }}
      />
    </Space>
  );
};

export default SignalMonitorRealtimePage;
