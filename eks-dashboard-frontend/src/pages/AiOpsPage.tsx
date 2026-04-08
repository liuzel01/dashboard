import React, { useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography, App } from 'antd';
import {
  executeAiOpsSql,
  getAiOpsSqlAudit,
  previewAiOpsSql,
} from '../services/api';

const { TextArea } = Input;
const { Text } = Typography;

type PreviewResponse = {
  ok: boolean;
  source: 'question' | 'sql';
  normalizedSql: string;
  executedSql: string;
  appliedLimit: number;
  timeoutMs: number;
};

type ExecuteResponse = {
  ok: boolean;
  source: 'question' | 'sql';
  executedSql: string;
  appliedLimit: number;
  rowCount: number;
  rows: Record<string, unknown>[];
};

type AuditItem = {
  id: number;
  status: string;
  actor_username?: string;
  question?: string;
  executed_sql?: string;
  row_count?: number;
  created_at?: string;
};

const AiOpsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);

  const [form] = Form.useForm();

  const onPreview = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const resp = await previewAiOpsSql({
        question: values.question?.trim() || undefined,
        sql: values.sql?.trim() || undefined,
      });
      setPreview(resp);
      message.success('SQL 预览成功');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || 'SQL 预览失败');
    } finally {
      setLoading(false);
    }
  };

  const onExecute = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const resp = await executeAiOpsSql({
        question: values.question?.trim() || undefined,
        sql: values.sql?.trim() || undefined,
      });
      setExecuteResult(resp);
      message.success(`执行成功，返回 ${resp.rowCount} 行`);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || 'SQL 执行失败');
    } finally {
      setLoading(false);
    }
  };

  const onLoadAudit = async () => {
    setLoading(true);
    try {
      const resp = await getAiOpsSqlAudit(1, 20);
      setAuditItems(Array.isArray(resp?.items) ? resp.items : []);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '审计读取失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="M0 + M1(部分)：已接入受控 SQL 预览/执行。仅允许只读 SQL，且会自动审计。"
      />

      <Card title="AI SQL 助手（受控）">
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="自然语言问题"
            name="question"
            rules={[{ required: false }]}
          >
            <TextArea rows={3} placeholder="示例：查询最近 1 小时失败订单前 20 条" />
          </Form.Item>

          <Form.Item
            label="或直接输入 SQL"
            name="sql"
            rules={[{ required: false }]}
          >
            <TextArea rows={5} placeholder="示例：SELECT * FROM tbl_user LIMIT 20" />
          </Form.Item>

          <Space>
            <Button onClick={onPreview} loading={loading}>预览 SQL</Button>
            <Button type="primary" onClick={onExecute} loading={loading}>执行 SQL</Button>
            <Button onClick={onLoadAudit} loading={loading}>刷新审计</Button>
          </Space>
        </Form>
      </Card>

      {preview && (
        <Card title="预览结果">
          <p><Text strong>来源：</Text>{preview.source}</p>
          <p><Text strong>执行 SQL：</Text></p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.executedSql}</pre>
          <p>
            <Tag color="blue">LIMIT {preview.appliedLimit}</Tag>
            <Tag color="purple">超时 {preview.timeoutMs}ms</Tag>
          </p>
        </Card>
      )}

      {executeResult && (
        <Card title="执行结果">
          <p><Text strong>行数：</Text>{executeResult.rowCount}</p>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
            {JSON.stringify(executeResult.rows, null, 2)}
          </pre>
        </Card>
      )}

      <Card title="最近 SQL 审计（20 条）">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={auditItems}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 80 },
            { title: '用户', dataIndex: 'actor_username', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <Tag color={value === 'executed' ? 'green' : value === 'error' ? 'red' : 'blue'}>
                  {value}
                </Tag>
              ),
            },
            { title: '问题', dataIndex: 'question', ellipsis: true },
            { title: '返回行数', dataIndex: 'row_count', width: 100 },
            { title: '时间', dataIndex: 'created_at', width: 180 },
          ]}
        />
      </Card>
    </Space>
  );
};

export default AiOpsPage;
