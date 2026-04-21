import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Switch, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getSignalMonitorRealtime } from '../services/signalMonitorApi';
import type { RealtimeItem } from '../services/signalMonitorApi';

const SignalMonitorRealtimePage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RealtimeItem[]>([]);
  const [lastTs, setLastTs] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  const highCount = useMemo(() => rows.filter((r) => r.priority === 'high').length, [rows]);

  const columns: ColumnsType<RealtimeItem> = [
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
    { title: '最新价格', dataIndex: 'latest_price', key: 'latest_price' },
    { title: '最近触发时间', dataIndex: 'latest_trigger_time', key: 'latest_trigger_time' },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Row gutter={16}>
        <Col span={8}>
          <Card title="活跃信号数">{rows.length}</Card>
        </Col>
        <Col span={8}>
          <Card title="高优先级信号">{highCount}</Card>
        </Col>
        <Col span={8}>
          <Card title="最近刷新时间">{lastTs || '-'}</Card>
        </Col>
      </Row>

      <Space>
        <Button onClick={load} loading={loading}>刷新</Button>
        <span>自动刷新</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} />
      </Space>

      <Table<RealtimeItem>
        rowKey={(r) => `${r.symbol}:${r.timeframe}:${r.rule}:${r.direction}`}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="暂无实时信号" /> }}
      />
    </Space>
  );
};

export default SignalMonitorRealtimePage;
