import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getSignalMonitorRealtime } from '../services/signalMonitorApi';
import type { RealtimeItem } from '../services/signalMonitorApi';

const SignalMonitorRealtimePage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RealtimeItem[]>([]);
  const [lastTs, setLastTs] = useState<string>('');

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
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const highCount = useMemo(() => rows.filter((r) => r.priority === 'high').length, [rows]);

  const columns: ColumnsType<RealtimeItem> = [
    { title: 'Symbol', dataIndex: 'symbol', key: 'symbol' },
    { title: 'Timeframe', dataIndex: 'timeframe', key: 'timeframe' },
    { title: 'Rule', dataIndex: 'rule', key: 'rule' },
    { title: 'Direction', dataIndex: 'direction', key: 'direction' },
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'default'}>{v}</Tag>,
    },
    { title: 'Latest Price', dataIndex: 'latest_price', key: 'latest_price' },
    { title: 'Latest Trigger Time', dataIndex: 'latest_trigger_time', key: 'latest_trigger_time' },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Row gutter={16}>
        <Col span={8}>
          <Card title="Active Signals">{rows.length}</Card>
        </Col>
        <Col span={8}>
          <Card title="High Priority">{highCount}</Card>
        </Col>
        <Col span={8}>
          <Card title="Last Refresh">{lastTs || '-'}</Card>
        </Col>
      </Row>

      <Space>
        <Button onClick={load} loading={loading}>刷新</Button>
      </Space>

      <Table<RealtimeItem>
        rowKey={(r) => `${r.symbol}:${r.timeframe}:${r.rule}:${r.direction}`}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
      />
    </Space>
  );
};

export default SignalMonitorRealtimePage;
