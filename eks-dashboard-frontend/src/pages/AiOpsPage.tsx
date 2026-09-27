import React, { useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Table, Tag, Typography, App } from 'antd';
import {
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
  appliedLimit: number | null;
  timeoutMs: number;
  sqlType?: 'read' | 'write' | 'ddl' | 'unknown';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
};

type AuditItem = {
  id: number;
  status: string;
  sql_type?: 'read' | 'write' | 'ddl' | 'unknown';
  risk_level?: 'low' | 'medium' | 'high' | 'critical';
  actor_display_name?: string;
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
      message.error((err as ApiError)?.response?.data?.message || (err as ApiError)?.message || 'SQL 预览失败');
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
      message.error((err as ApiError)?.response?.data?.message || (err as ApiError)?.message || '审计读取失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="当前仅支持 SQL 预览与分析，不在 dashboard 内执行 SQL。"
        description="页面中的 SQL 结果仅作为草稿建议，未在本系统执行。任何真实变更请在外部系统（如 abd.com）完成，并执行人工复核。"
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
            <Button onClick={onLoadAudit} loading={loading}>刷新审计</Button>
          </Space>
        </Form>
      </Card>

      {preview && (
        <Card title="预览结果">
          <p><Text strong>来源：</Text>{preview.source}</p>
          <p><Text strong>预览 SQL：</Text></p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.executedSql}</pre>
          <p>
            {typeof preview.appliedLimit === 'number' && (
              <Tag color="blue">LIMIT {preview.appliedLimit}</Tag>
            )}
            <Tag color="purple">超时 {preview.timeoutMs}ms</Tag>
            {preview.sqlType && (
              <Tag color="geekblue">类型 {preview.sqlType}</Tag>
            )}
            {preview.riskLevel && (
              <Tag color={
                preview.riskLevel === 'critical'
                  ? 'red'
                  : preview.riskLevel === 'high'
                    ? 'volcano'
                    : preview.riskLevel === 'medium'
                      ? 'gold'
                      : 'green'
              }
              >
                风险 {preview.riskLevel}
              </Tag>
            )}
          </p>
          <Alert
            type="warning"
            showIcon
            message="仅草稿预览，未执行"
            description="请勿直接将结果视作已生效变更。若需执行，请在外部系统完成审批与复核。"
          />
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
            {
              title: '用户',
              width: 160,
              render: (_: unknown, row: AuditItem) => row.actor_display_name || row.actor_username || '-',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <Tag color={value === 'previewed' ? 'blue' : value === 'error' ? 'red' : 'default'}>
                  {value}
                </Tag>
              ),
            },
            {
              title: 'SQL类型',
              dataIndex: 'sql_type',
              width: 100,
              render: (value?: string) => value ? <Tag color="geekblue">{value}</Tag> : '-',
            },
            {
              title: '风险',
              dataIndex: 'risk_level',
              width: 100,
              render: (value?: string) => {
                if (!value) return '-';
                const color =
                  value === 'critical'
                    ? 'red'
                    : value === 'high'
                      ? 'volcano'
                      : value === 'medium'
                        ? 'gold'
                        : 'green';
                return <Tag color={color}>{value}</Tag>;
              },
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
