import React, { useEffect, useState } from 'react';
import { Alert, Card, Col, Empty, Row, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getSignalMonitorStats24h } from '../services/signalMonitorApi';
import type { Stats24hResponse } from '../services/signalMonitorApi';

type RuleRow = {
  rule: string;
  trigger_count: number;
  emitted_count: number;
};

const SignalMonitorStatsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats24hResponse | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSignalMonitorStats24h();
      setStats(data);
    } catch (e: any) {
      setError(e?.message || '加载 stats 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const ruleColumns: ColumnsType<RuleRow> = [
    { title: 'Rule', dataIndex: 'rule', key: 'rule' },
    { title: 'Trigger Count', dataIndex: 'trigger_count', key: 'trigger_count' },
    { title: 'Emitted Count', dataIndex: 'emitted_count', key: 'emitted_count' },
  ];

  const suppressedRows = stats
    ? Object.entries(stats.suppressed_breakdown || {}).map(([reason, count]) => ({ reason, count }))
    : [];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Row gutter={16}>
        <Col span={6}><Card loading={loading} title="Trigger 24h">{stats?.trigger_count ?? 0}</Card></Col>
        <Col span={6}><Card loading={loading} title="Emitted 24h">{stats?.emitted_count ?? 0}</Card></Col>
        <Col span={6}><Card loading={loading} title="Suppressed 24h">{stats?.suppressed_count ?? 0}</Card></Col>
        <Col span={6}><Card loading={loading} title="Success Rate">{((stats?.send_success_rate ?? 0) * 100).toFixed(2)}%</Card></Col>
      </Row>

      <Card title="By Rule" loading={loading}>
        <Table<RuleRow>
          rowKey={(r) => r.rule}
          columns={ruleColumns}
          dataSource={stats?.by_rule || []}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无规则统计" /> }}
        />
      </Card>

      <Card title="Suppressed Breakdown" loading={loading}>
        {suppressedRows.length === 0 ? (
          <Empty description="暂无抑制记录" />
        ) : (
          <Space wrap>
            {suppressedRows.map((row) => (
              <Tag key={row.reason}>{row.reason}: {row.count}</Tag>
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
};

export default SignalMonitorStatsPage;
