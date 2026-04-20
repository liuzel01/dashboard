import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Input, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import { getSignalMonitorDailyReport } from '../services/signalMonitorApi';
import type { DailyReportResponse } from '../services/signalMonitorApi';

const { Paragraph, Text } = Typography;

const SignalMonitorDailyPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(dayjs());
  const [data, setData] = useState<DailyReportResponse | null>(null);

  const dateStr = useMemo(() => date.format('YYYY-MM-DD'), [date]);

  const load = async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getSignalMonitorDailyReport(d);
      setData(resp);
    } catch (e: any) {
      setError(e?.message || '加载日报失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(dateStr);
  }, [dateStr]);

  const onCopy = async () => {
    if (!data?.markdown) return;
    await navigator.clipboard.writeText(data.markdown);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Space>
        <DatePicker value={date} onChange={(d) => d && setDate(d)} />
        <Button onClick={() => load(dateStr)} loading={loading}>刷新</Button>
        <Button onClick={onCopy} disabled={!data?.markdown}>复制 Markdown</Button>
      </Space>

      <Card title={`Daily Report (${data?.date || dateStr})`} loading={loading}>
        {!data ? (
          <Empty description="暂无日报数据" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text>trigger_count: {data.summary?.trigger_count ?? 0}</Text>
            <Text>top_noise_rules: {(data.summary?.top_noise_rules || []).join(', ') || '-'}</Text>
            <Paragraph>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{data.markdown}</pre>
            </Paragraph>
          </Space>
        )}
      </Card>

      <Card title="Markdown 原文（便于前端后续替换富文本渲染）">
        <Input.TextArea value={data?.markdown || ''} autoSize={{ minRows: 8, maxRows: 20 }} readOnly />
      </Card>
    </Space>
  );
};

export default SignalMonitorDailyPage;
