import React, { useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, App } from 'antd';
import {
  getAiOpsLogSources,
  getAiOpsSqlAudit,
  previewAiOpsSql,
  searchAiOpsLogs,
} from '../services/api';
import { InlineHelpTooltip } from '../components/ops';

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

type LogSource = {
  projectId: string;
  sourceId: string;
  provider: string;
  serviceAccount: string;
  allowedNamespaces: string[];
  allowedServices: string[];
  maxRangeHours: number;
  maxLines: number;
};

type LogEvidence = {
  evidenceId: string;
  timestamp: string;
  labels: Record<string, string>;
  line: string;
};

const AiOpsPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [logSourceLoading, setLogSourceLoading] = useState(false);
  const [logSearchLoading, setLogSearchLoading] = useState(false);
  const [logSources, setLogSources] = useState<LogSource[]>([]);
  const [logEvidence, setLogEvidence] = useState<LogEvidence[]>([]);
  const [exploreUrl, setExploreUrl] = useState('');

  const [form] = Form.useForm();
  const [logForm] = Form.useForm();
  const selectedLogSourceId = Form.useWatch('sourceId', logForm);

  const loadLogSources = async () => {
    setLogSourceLoading(true);
    try {
      const response = await getAiOpsLogSources();
      const items = Array.isArray(response?.items) ? response.items : [];
      setLogSources(items);
      if (items.length === 1) {
        logForm.setFieldsValue({
          sourceId: items[0].sourceId,
          namespace: items[0].allowedNamespaces?.[0],
          limit: Math.min(100, items[0].maxLines || 100),
        });
      }
      if (items.length === 0) message.warning('当前环境尚未配置可用日志源');
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '日志源加载失败');
    } finally {
      setLogSourceLoading(false);
    }
  };

  const onSearchLogs = async () => {
    const values = await logForm.validateFields();
    const source = logSources.find((item) => item.sourceId === values.sourceId);
    if (!source) {
      message.error('请先加载并选择当前环境的日志源');
      return;
    }
    if (!values.serviceName?.trim() && !values.queryText?.trim()) {
      message.error('请至少填写服务名称或调查线索');
      return;
    }
    setLogSearchLoading(true);
    setLogEvidence([]);
    setExploreUrl('');
    try {
      const range = values.timeRange;
      const response = await searchAiOpsLogs({
        projectId: source.projectId,
        sourceId: source.sourceId,
        namespace: values.namespace,
        serviceName: values.serviceName?.trim() || undefined,
        queryText: values.queryText?.trim() || undefined,
        from: range?.[0]?.toISOString(),
        to: range?.[1]?.toISOString(),
        limit: values.limit,
      });
      setLogEvidence(Array.isArray(response?.evidence) ? response.evidence : []);
      setExploreUrl(response?.exploreUrl || '');
      message.success(`日志查询完成，共 ${response?.evidence?.length || 0} 条脱敏证据`);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '日志查询失败');
    } finally {
      setLogSearchLoading(false);
    }
  };

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
      <Card
        title="项目日志调查（Phase 1，只读）"
        extra={<Button onClick={loadLogSources} loading={logSourceLoading}>加载当前环境日志源</Button>}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="环境隔离的受控日志检索"
          description="查询只使用左上角当前环境对应的 Dashboard 专用 Grafana SA。可按服务或任意日志线索检索，UID、positionId、orderId、traceId 只是可选提示；后端限制 namespace、时间范围和返回数量，并在展示前脱敏。本阶段不会让模型自动生成 LogQL。"
        />
        <Form form={logForm} layout="vertical" requiredMark={false}>
          <Space wrap align="start" style={{ width: '100%' }}>
            <Form.Item label="日志源" name="sourceId" rules={[{ required: true, message: '请先加载并选择日志源' }]}>
              <Select style={{ width: 220 }} options={logSources.map((item) => ({ value: item.sourceId, label: `${item.projectId} / ${item.sourceId}` }))} />
            </Form.Item>
            <Form.Item label="Namespace" name="namespace" rules={[{ required: true }]}>
              <Select
                showSearch
                style={{ width: 180 }}
                options={(logSources.find((item) => item.sourceId === selectedLogSourceId)?.allowedNamespaces || []).map((value) => ({ value, label: value }))}
              />
            </Form.Item>
            <Form.Item label="服务（可选）" name="serviceName">
              <Input style={{ width: 260 }} placeholder="精确匹配 service_name" />
            </Form.Item>
            <Form.Item
              label="调查线索（与服务至少填写一项）"
              name="queryText"
              tooltip="当前阶段按日志原文进行受控匹配；可以填写错误信息、错误码、接口路径、UID、positionId、orderId、traceId 等。宽泛关键字建议同时选择服务，以降低 Loki 扫描成本。"
            >
              <Input style={{ width: 420 }} placeholder="例如：connection refused、errorCode=500、uid=...、positionId=...、traceId=...（建议同时填写服务）" />
            </Form.Item>
            <Form.Item label="时间范围（默认最近 1 小时）" name="timeRange">
              <DatePicker.RangePicker showTime style={{ width: 360 }} />
            </Form.Item>
            <Form.Item label="最多返回" name="limit" initialValue={100}>
              <InputNumber min={1} max={1000} />
            </Form.Item>
          </Space>
          <Space>
            <Button type="primary" onClick={onSearchLogs} loading={logSearchLoading}>查询脱敏日志</Button>
            {exploreUrl && <Button href={exploreUrl} target="_blank" rel="noreferrer">在 Grafana Explore 查看</Button>}
          </Space>
        </Form>
      </Card>

      <Card title={`日志证据（${logEvidence.length}）`}>
        <Table
          size="small"
          rowKey="evidenceId"
          dataSource={logEvidence}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            { title: '时间', dataIndex: 'timestamp', width: 210 },
            { title: '服务', width: 220, render: (_: unknown, row: LogEvidence) => row.labels.service_name || row.labels.app || '-' },
            { title: 'Pod', width: 240, render: (_: unknown, row: LogEvidence) => row.labels.pod || '-' },
            { title: 'Evidence ID', dataIndex: 'evidenceId', width: 190 },
            { title: '脱敏日志', dataIndex: 'line', render: (value: string) => <Text code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{value}</Text> },
          ]}
        />
      </Card>

      <Card
        title={(
          <Space size={6} align="center">
            <span>AI SQL 助手（受控）</span>
            <InlineHelpTooltip
              ariaLabel="AI SQL 使用说明"
              content="当前仅支持 SQL 预览与分析，不在 dashboard 内执行 SQL。页面中的 SQL 结果仅作为草稿建议；任何真实变更请在外部系统（如 abd.com）完成，并执行人工复核。"
            />
          </Space>
        )}
      >
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
