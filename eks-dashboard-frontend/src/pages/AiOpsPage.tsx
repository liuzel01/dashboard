import React, { useContext, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { Alert, AutoComplete, Button, Card, DatePicker, Form, Input, InputNumber, Radio, Select, Space, Table, Tag, Typography, App } from 'antd';
import {
  getAiOpsLogSources,
  getAiOpsLogInvestigationJob,
  getAiOpsLogInvestigationJobs,
  getAiOpsLogInvestigationReport,
  getAiOpsLogInvestigationReports,
  correlateAiOpsLogInvestigations,
  createAiOpsLogInvestigationCase,
  getAiOpsLogInvestigationCase,
  getAiOpsLogInvestigationCases,
  getAiOpsSqlAudit,
  investigateAiOpsLogs,
  previewAiOpsSql,
} from '../services/api';
import { InlineHelpTooltip } from '../components/ops';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { getDisplayTimeZone } from '../utils/time';

dayjs.extend(utc);
dayjs.extend(timezone);

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

type InvestigationResult = {
  planVersion: string;
  model: string;
  plan: {
    intent: string;
    namespace: string;
    serviceName: string | null;
    queryTexts: string[];
    rangeMinutes: number;
    limit: number;
  };
  answer: {
    summary: string;
    findings: Array<{ text: string; evidenceIds: string[] }>;
    evidenceIds: string[];
    confidence: 'low' | 'medium' | 'high';
    insufficientEvidence: boolean;
  };
  evidence: LogEvidence[];
  exploreUrls: string[];
  execution?: {
    requested: 'mcp' | 'direct';
    used: string[];
    fallbackReasons: string[];
  };
  labelDiscovery?: {
    names: string[];
    values: Record<string, string[]>;
  } | null;
  rounds?: Array<{
    round: number;
    reason: string;
    serviceName: string | null;
    queryTexts: string[];
    newEvidenceCount: number;
  }>;
  queryStatistics?: Array<{
    serviceName: string | null;
    queryTexts: string[];
    matchingLines: number | null;
    sampledLines: number;
    truncated: boolean | null;
  }>;
  categoryStatistics?: Array<{
    key: string;
    label: string;
    matchingLines: number | null;
  }>;
  entities?: Array<{
    type: string;
    value: string;
    normalizedValue?: string;
    role?: string | null;
    confidence?: 'low' | 'medium' | 'high';
    evidenceIds: string[];
  }>;
};

type InvestigationJob = {
  jobId: number;
  question: string;
  actorUsername: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  attemptCount: number;
  errorMessage?: string | null;
  createdAt: string;
};

type InvestigationCorrelation = {
  reportId: number;
  jobIds: number[];
  sharedEntities: Array<{
    type: string;
    value: string;
    role?: string | null;
    jobIds: number[];
    evidenceIds: string[];
  }>;
  entities: Array<{
    type: string;
    value: string;
    role?: string | null;
    jobIds: number[];
    evidenceIds: string[];
  }>;
  relations: Array<{
    source: { type: string; normalizedValue: string; role: string | null };
    relation: string;
    target: { type: string; normalizedValue: string; role: string | null };
    confidence: 'low' | 'medium' | 'high';
    evidenceIds: string[];
    jobIds: number[];
  }>;
  model: string | null;
  report: {
    reportType: string;
    title: string;
    summary: string;
    sections: Array<{
      key: string;
      title: string;
      findings: Array<{ text: string; evidenceIds: string[] }>;
    }>;
    timeline: Array<{ timestamp: string; text: string; evidenceIds: string[] }>;
    uncertainties: string[];
    recommendations: string[];
    confidence: 'low' | 'medium' | 'high';
  };
  generatedAt: string;
};

type InvestigationReportSummary = {
  reportId: number;
  actorUsername: string;
  jobIds: number[];
  title: string;
  reportType: string;
  confidence: 'low' | 'medium' | 'high';
  createdAt: string;
};

type InvestigationCase = {
  caseId: number;
  actorUsername: string;
  seedJobIds: number[];
  childJobIds: number[];
  status: 'CREATING' | 'WAITING' | 'REPORTING' | 'COMPLETED' | 'FAILED';
  finalReportId?: number | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

const AiOpsPage: React.FC<{ mode?: 'logs' | 'sql' }> = ({ mode = 'logs' }) => {
  const { message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [logSourceLoading, setLogSourceLoading] = useState(false);
  const [logSources, setLogSources] = useState<LogSource[]>([]);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [trackingInvestigationJobId, setTrackingInvestigationJobId] = useState<number | null>(null);
  const [investigationResult, setInvestigationResult] = useState<InvestigationResult | null>(null);
  const [investigationJobs, setInvestigationJobs] = useState<InvestigationJob[]>([]);
  const [investigationJobsLoading, setInvestigationJobsLoading] = useState(false);
  const [selectedInvestigationJobIds, setSelectedInvestigationJobIds] = useState<number[]>([]);
  const [correlationLoading, setCorrelationLoading] = useState(false);
  const [correlationResult, setCorrelationResult] = useState<InvestigationCorrelation | null>(null);
  const [investigationReports, setInvestigationReports] = useState<InvestigationReportSummary[]>([]);
  const [investigationReportsLoading, setInvestigationReportsLoading] = useState(false);
  const [investigationCases, setInvestigationCases] = useState<InvestigationCase[]>([]);
  const [investigationCasesLoading, setInvestigationCasesLoading] = useState(false);
  const [investigationCaseActionLoading, setInvestigationCaseActionLoading] = useState(false);
  const [trackingInvestigationCaseId, setTrackingInvestigationCaseId] = useState<number | null>(null);

  const [form] = Form.useForm();
  const [investigationForm] = Form.useForm();
  const selectedInvestigationSourceId = Form.useWatch('sourceId', investigationForm);
  const investigationTimeMode = Form.useWatch('timeMode', investigationForm) || 'relative';
  const displayTimeZone = getDisplayTimeZone();
  const activeJobStorageKey = `aiops.activeLogInvestigationJobId.${currentEnvironment?.id || 'unknown'}`;

  const loadInvestigationJobs = async () => {
    setInvestigationJobsLoading(true);
    try {
      const response = await getAiOpsLogInvestigationJobs(1, 20);
      setInvestigationJobs(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '调查任务加载失败');
    } finally {
      setInvestigationJobsLoading(false);
    }
  };

  const loadInvestigationReports = async () => {
    setInvestigationReportsLoading(true);
    try {
      const response = await getAiOpsLogInvestigationReports(1, 20);
      setInvestigationReports(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '联合调查报告加载失败');
    } finally {
      setInvestigationReportsLoading(false);
    }
  };

  const loadInvestigationCases = async () => {
    setInvestigationCasesLoading(true);
    try {
      const response = await getAiOpsLogInvestigationCases(1, 20);
      setInvestigationCases(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '深度调查 Case 加载失败');
    } finally {
      setInvestigationCasesLoading(false);
    }
  };

  const onOpenInvestigationReport = async (reportId: number) => {
    setInvestigationReportsLoading(true);
    try {
      setCorrelationResult(await getAiOpsLogInvestigationReport(reportId));
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '联合调查报告读取失败');
    } finally {
      setInvestigationReportsLoading(false);
    }
  };

  const waitForInvestigation = async (jobId: number) => {
    window.localStorage.setItem(activeJobStorageKey, String(jobId));
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const job = await getAiOpsLogInvestigationJob(jobId);
      if (job?.status === 'COMPLETED') {
        window.localStorage.removeItem(activeJobStorageKey);
        setInvestigationResult(job.result);
        await loadInvestigationJobs();
        message.success(job.result?.answer?.insufficientEvidence ? '调查完成，但当前证据不足' : 'AI 日志调查完成');
        return;
      }
      if (job?.status === 'FAILED') {
        window.localStorage.removeItem(activeJobStorageKey);
        await loadInvestigationJobs();
        throw new Error(job.errorMessage || '后台日志调查失败');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    throw new Error(`日志调查任务 #${jobId} 仍在后台执行，可稍后从最近调查中继续查看`);
  };

  const waitForInvestigationCase = async (caseId: number) => {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const investigationCase = await getAiOpsLogInvestigationCase(caseId);
      setInvestigationCases((items) => [investigationCase, ...items.filter((item) => item.caseId !== caseId)]);
      if (investigationCase?.status === 'COMPLETED') {
        if (investigationCase.finalReportId) {
          setCorrelationResult(await getAiOpsLogInvestigationReport(investigationCase.finalReportId));
        }
        await Promise.all([loadInvestigationCases(), loadInvestigationJobs(), loadInvestigationReports()]);
        message.success(`深度调查 Case #${caseId} 已生成最终报告`);
        return;
      }
      if (investigationCase?.status === 'FAILED') {
        await loadInvestigationCases();
        throw new Error(investigationCase.errorMessage || '深度调查执行失败');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error(`深度调查 Case #${caseId} 仍在后台执行，可稍后继续查看`);
  };

  const onCreateInvestigationCase = async () => {
    if (selectedInvestigationJobIds.length < 2) {
      message.warning('请至少选择两个已完成的调查任务');
      return;
    }
    setInvestigationCaseActionLoading(true);
    try {
      const result = await createAiOpsLogInvestigationCase(selectedInvestigationJobIds);
      const caseId = Number(result?.caseId);
      if (!Number.isInteger(caseId) || caseId < 1) throw new Error('后端未返回有效的深度调查 Case ID');
      message.info(`深度调查 Case #${caseId} 已创建，正在执行 ${result.childJobIds?.length || 0} 个补查任务`);
      await loadInvestigationCases();
      setTrackingInvestigationCaseId(caseId);
      await waitForInvestigationCase(caseId);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '深度调查创建失败');
    } finally {
      setTrackingInvestigationCaseId(null);
      setInvestigationCaseActionLoading(false);
    }
  };

  const onOpenInvestigationCase = async (item: InvestigationCase) => {
    setTrackingInvestigationCaseId(item.caseId);
    try {
      if (item.status === 'COMPLETED' && item.finalReportId) {
        setCorrelationResult(await getAiOpsLogInvestigationReport(item.finalReportId));
      } else if (item.status === 'FAILED') {
        message.error(item.errorMessage || '深度调查执行失败');
      } else {
        await waitForInvestigationCase(item.caseId);
      }
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '深度调查读取失败');
    } finally {
      setTrackingInvestigationCaseId(null);
    }
  };

  const onOpenInvestigationJob = async (job: InvestigationJob) => {
    setTrackingInvestigationJobId(job.jobId);
    try {
      if (job.status === 'COMPLETED') {
        const latest = await getAiOpsLogInvestigationJob(job.jobId);
        setInvestigationResult(latest.result);
        return;
      }
      await waitForInvestigation(job.jobId);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '调查任务读取失败');
    } finally {
      setTrackingInvestigationJobId(null);
    }
  };

  useEffect(() => {
    if (mode !== 'logs' || !currentEnvironment?.id) return;
    void loadInvestigationJobs();
    void loadInvestigationReports();
    void loadInvestigationCases();
    const activeJobId = Number(window.localStorage.getItem(activeJobStorageKey));
    if (Number.isInteger(activeJobId) && activeJobId > 0) {
      setInvestigationLoading(true);
      void waitForInvestigation(activeJobId)
        .catch((error: Error) => message.error(error.message || '恢复日志调查失败'))
        .finally(() => setInvestigationLoading(false));
    }
    // This page owns the recovery lifecycle; environment changes remount the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentEnvironment?.id]);

  const loadLogSources = async () => {
    setLogSourceLoading(true);
    try {
      const response = await getAiOpsLogSources();
      const items = Array.isArray(response?.items) ? response.items : [];
      setLogSources(items);
      if (items.length === 1) {
        const namespaces = items[0].allowedNamespaces || [];
        investigationForm.setFieldsValue({
          sourceId: items[0].sourceId,
          namespace: namespaces.includes('default') ? 'default' : namespaces[0],
          rangeMinutes: 60,
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

  const onInvestigate = async () => {
    const values = await investigationForm.validateFields();
    const source = logSources.find((item) => item.sourceId === values.sourceId);
    if (!source) {
      message.error('请先加载并选择当前环境的日志源');
      return;
    }
    setInvestigationLoading(true);
    setInvestigationResult(null);
    try {
      const response = await investigateAiOpsLogs({
        projectId: source.projectId,
        sourceId: source.sourceId,
        namespace: values.namespace || undefined,
        question: values.question.trim(),
        serviceName: values.serviceName?.trim() || undefined,
        queryText: values.queryText?.trim() || undefined,
        timeMode: values.timeMode || 'relative',
        rangeMinutes: values.timeMode === 'absolute' ? undefined : values.rangeMinutes,
        from: values.timeMode === 'absolute' && values.absoluteRange?.[0] ? dayjs.tz(values.absoluteRange[0].format('YYYY-MM-DD HH:mm:ss'), displayTimeZone).toISOString() : undefined,
        to: values.timeMode === 'absolute' && values.absoluteRange?.[1] ? dayjs.tz(values.absoluteRange[1].format('YYYY-MM-DD HH:mm:ss'), displayTimeZone).toISOString() : undefined,
        limit: values.limit,
      });
      const jobId = Number(response?.jobId);
      if (!Number.isInteger(jobId) || jobId < 1) throw new Error('后端未返回有效调查任务 ID');
      message.info(`日志调查任务 #${jobId} 已进入后台队列`);
      await loadInvestigationJobs();
      await waitForInvestigation(jobId);
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || 'AI 日志调查失败');
    } finally {
      setInvestigationLoading(false);
    }
  };

  const onCorrelateInvestigations = async () => {
    if (selectedInvestigationJobIds.length < 2) {
      message.warning('请至少选择两个已完成的调查任务');
      return;
    }
    setCorrelationLoading(true);
    try {
      const result = await correlateAiOpsLogInvestigations(selectedInvestigationJobIds);
      setCorrelationResult(result);
      await loadInvestigationReports();
      message.success('跨任务证据关联完成');
    } catch (error) {
      const err = error as ApiError;
      message.error(err.response?.data?.message || err.message || '跨任务证据关联失败');
    } finally {
      setCorrelationLoading(false);
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
      const err = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
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
      const err = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      message.error((err as ApiError)?.response?.data?.message || (err as ApiError)?.message || '审计读取失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {mode === 'logs' && (
        <>
          <Card
            title="AI 项目日志调查"
            extra={
              <Button onClick={loadLogSources} loading={logSourceLoading}>
                加载当前环境日志源
              </Button>
            }
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="自然语言问题，异步调查，证据引用"
              description="用户只需提供当前已知线索。Namespace、服务、UID、邮箱、接口、IP 等均为可选条件；后台 Agent 会生成受控计划，通过只读 Grafana MCP 查询并基于证据形成结论。"
            />
            <Form form={investigationForm} layout="vertical" requiredMark={false}>
              <Form.Item
                label="调查问题"
                name="question"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: '请输入需要调查的问题',
                  },
                ]}
              >
                <TextArea rows={3} maxLength={2000} showCount placeholder="例如：orders 服务最近为什么出现 connection refused？也可以包含 UID、positionId、orderId 或 traceId。" />
              </Form.Item>
              <Space wrap align="start" style={{ width: '100%' }}>
                <Form.Item label="日志源" name="sourceId" rules={[{ required: true, message: '请先加载日志源' }]}>
                  <Select
                    style={{ width: 220 }}
                    options={logSources.map((item) => ({
                      value: item.sourceId,
                      label: `${item.projectId} / ${item.sourceId}`,
                    }))}
                  />
                </Form.Item>
                <Form.Item label="Namespace（可选）" name="namespace">
                  <AutoComplete
                    allowClear
                    style={{ width: 180 }}
                    placeholder="选择或输入 Namespace"
                    filterOption={(inputValue, option) =>
                      String(option?.value || '')
                        .toLowerCase()
                        .includes(inputValue.toLowerCase())
                    }
                    options={(logSources.find((item) => item.sourceId === selectedInvestigationSourceId)?.allowedNamespaces || []).map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
                <Form.Item label="服务约束（可选）" name="serviceName">
                  <Input style={{ width: 260 }} placeholder="精确 service_name" />
                </Form.Item>
                <Form.Item label="必须包含的日志线索（可选）" name="queryText">
                  <Input style={{ width: 340 }} placeholder="错误文本、错误码、UID、traceId 等" />
                </Form.Item>
                <Form.Item label="时间模式" name="timeMode" initialValue="relative">
                  <Radio.Group
                    optionType="button"
                    buttonStyle="solid"
                    options={[
                      { label: '相对时间', value: 'relative' },
                      { label: '绝对时间', value: 'absolute' },
                    ]}
                  />
                </Form.Item>
                {investigationTimeMode === 'relative' ? (
                  <Form.Item label="调查范围（分钟）" name="rangeMinutes" initialValue={60} tooltip="未指定服务时后端最多允许 60 分钟；指定服务后可在日志源上限内扩大。">
                    <InputNumber min={1} max={1440} />
                  </Form.Item>
                ) : (
                  <Form.Item label={`绝对时间范围（${displayTimeZone}）`} name="absoluteRange" rules={[{ required: true, message: '请选择开始和结束时间' }]}>
                    <DatePicker.RangePicker showTime allowClear={false} format="YYYY-MM-DD HH:mm:ss" />
                  </Form.Item>
                )}
                <Form.Item label="最多证据" name="limit" initialValue={100} tooltip="单次调查最多汇总 500 条证据；每次 Loki 查询仍受日志源单次上限约束。">
                  <InputNumber min={1} max={500} />
                </Form.Item>
              </Space>
              <Button type="primary" onClick={onInvestigate} loading={investigationLoading}>
                开始受控调查
              </Button>
            </Form>
          </Card>

          <Card
            title="最近日志调查"
            extra={
              <Space>
                <Button disabled={selectedInvestigationJobIds.length < 2} loading={correlationLoading} onClick={onCorrelateInvestigations}>
                  关联分析已选任务
                </Button>
                <Button type="primary" disabled={selectedInvestigationJobIds.length < 2} loading={investigationCaseActionLoading} onClick={onCreateInvestigationCase}>
                  深度调查已选任务
                </Button>
                <Button onClick={loadInvestigationJobs} loading={investigationJobsLoading}>
                  刷新
                </Button>
              </Space>
            }
          >
            <Table
              size="small"
              rowKey="jobId"
              loading={investigationJobsLoading}
              dataSource={investigationJobs}
              rowSelection={{
                selectedRowKeys: selectedInvestigationJobIds,
                onChange: (keys) => setSelectedInvestigationJobIds(keys.map(Number)),
                getCheckboxProps: (record) => ({
                  disabled: record.status !== 'COMPLETED',
                }),
              }}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                {
                  title: '任务',
                  dataIndex: 'jobId',
                  width: 90,
                  render: (value: number) => `#${value}`,
                },
                { title: '调查问题', dataIndex: 'question', ellipsis: true },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 120,
                  render: (value: string) => <Tag color={value === 'COMPLETED' ? 'green' : value === 'FAILED' ? 'red' : 'blue'}>{value}</Tag>,
                },
                { title: '发起人', dataIndex: 'actorUsername', width: 140 },
                { title: '创建时间', dataIndex: 'createdAt', width: 200 },
                {
                  title: '操作',
                  width: 110,
                  fixed: 'right',
                  render: (_: unknown, row: InvestigationJob) => (
                    <Button
                      type="link"
                      loading={trackingInvestigationJobId === row.jobId}
                      disabled={trackingInvestigationJobId !== null && trackingInvestigationJobId !== row.jobId}
                      onClick={() => void onOpenInvestigationJob(row)}
                    >
                      {row.status === 'COMPLETED' ? '查看' : '继续追踪'}
                    </Button>
                  ),
                },
              ]}
              scroll={{ x: 900 }}
            />
          </Card>

          <Card title="深度调查 Case" extra={<Button onClick={loadInvestigationCases} loading={investigationCasesLoading}>刷新</Button>}>
            <Table
              size="small"
              rowKey="caseId"
              loading={investigationCasesLoading && trackingInvestigationCaseId === null}
              dataSource={investigationCases}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: 'Case', dataIndex: 'caseId', width: 90, render: (value: number) => `#${value}` },
                { title: '起始任务', dataIndex: 'seedJobIds', width: 220, render: (values: number[]) => values.map((id) => `#${id}`).join('、') },
                { title: '补查任务', dataIndex: 'childJobIds', ellipsis: true, render: (values: number[]) => values.length ? values.map((id) => `#${id}`).join('、') : '-' },
                { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <Tag color={value === 'COMPLETED' ? 'green' : value === 'FAILED' ? 'red' : 'blue'}>{value}</Tag> },
                { title: '最终报告', dataIndex: 'finalReportId', width: 110, render: (value?: number | null) => value ? `#${value}` : '-' },
                { title: '创建时间', dataIndex: 'createdAt', width: 190 },
                {
                  title: '操作',
                  width: 110,
                  fixed: 'right',
                  render: (_: unknown, row: InvestigationCase) => (
                    <Button type="link" loading={trackingInvestigationCaseId === row.caseId} disabled={trackingInvestigationCaseId !== null && trackingInvestigationCaseId !== row.caseId} onClick={() => void onOpenInvestigationCase(row)}>
                      {row.status === 'COMPLETED' ? '查看报告' : row.status === 'FAILED' ? '查看错误' : '继续追踪'}
                    </Button>
                  ),
                },
              ]}
              scroll={{ x: 1050 }}
            />
          </Card>

          <Card
            title="最近联合调查报告"
            extra={<Button onClick={loadInvestigationReports} loading={investigationReportsLoading}>刷新</Button>}
          >
            <Table
              size="small"
              rowKey="reportId"
              loading={investigationReportsLoading}
              dataSource={investigationReports}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: '报告', dataIndex: 'reportId', width: 90, render: (value: number) => `#${value}` },
                { title: '标题', dataIndex: 'title', ellipsis: true },
                { title: '类型', dataIndex: 'reportType', width: 130 },
                { title: '关联任务', dataIndex: 'jobIds', width: 220, render: (values: number[]) => values.map((id) => `#${id}`).join('、') },
                { title: '置信度', dataIndex: 'confidence', width: 100 },
                { title: '创建时间', dataIndex: 'createdAt', width: 190 },
                {
                  title: '操作',
                  width: 90,
                  fixed: 'right',
                  render: (_: unknown, row: InvestigationReportSummary) => (
                    <Button type="link" onClick={() => void onOpenInvestigationReport(row.reportId)}>
                      查看
                    </Button>
                  ),
                },
              ]}
              scroll={{ x: 950 }}
            />
          </Card>

          {correlationResult && (
            <Card title={`${correlationResult.report.title}（${correlationResult.jobIds.map((id) => `#${id}`).join('、')}）`}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color="blue">报告 #{correlationResult.reportId}</Tag>
                  <Tag>{correlationResult.report.reportType}</Tag>
                  <Tag color={correlationResult.report.confidence === 'high' ? 'green' : correlationResult.report.confidence === 'medium' ? 'gold' : 'default'}>
                    置信度 {correlationResult.report.confidence}
                  </Tag>
                  {correlationResult.model ? <Tag color="cyan">{correlationResult.model}</Tag> : null}
                </Space>
                <Alert type="info" showIcon message={correlationResult.report.summary} />
                {correlationResult.report.sections.map((section) => (
                  <div key={section.key}>
                    <Text strong>{section.title}：</Text>
                    <ul>
                      {section.findings.map((finding, index) => (
                        <li key={`${section.key}-${index}-${finding.text}`}>
                          {finding.text}{' '}
                          <Text type="secondary">[{finding.evidenceIds.join('、') || '无引用'}]</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {correlationResult.report.timeline.length ? (
                  <div>
                    <Text strong>证据时间线：</Text>
                    <ul>
                      {correlationResult.report.timeline.map((item, index) => (
                        <li key={`${item.timestamp}-${index}`}>
                          {item.timestamp || '-'}：{item.text}{' '}
                          <Text type="secondary">[{item.evidenceIds.join('、')}]</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {correlationResult.report.uncertainties.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="尚未确认事项"
                    description={correlationResult.report.uncertainties.join('；')}
                  />
                ) : null}
                {correlationResult.report.recommendations.length ? (
                  <div>
                    <Text strong>建议下一步：</Text>
                    <ul>
                      {correlationResult.report.recommendations.map((item, index) => (
                        <li key={`${index}-${item}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Alert
                  type={correlationResult.sharedEntities.length ? 'success' : 'warning'}
                  showIcon
                  message={correlationResult.sharedEntities.length ? `发现 ${correlationResult.sharedEntities.length} 个跨任务共同实体` : '暂未发现跨任务共同实体'}
                  description="共同实体来自实际日志证据；它表示任务间存在可追踪关联，不自动等同于因果关系。"
                />
                <Space wrap>
                  {correlationResult.sharedEntities.map((item) => (
                    <Tag color="purple" key={`${item.type}-${item.role || ''}-${item.value}`}>
                      {item.type}{item.role ? `(${item.role})` : ''}: {item.value} → {item.jobIds.map((id) => `#${id}`).join('、')}
                    </Tag>
                  ))}
                </Space>
                <div>
                  <Text strong>全部证据实体：</Text>
                  <Space wrap style={{ marginLeft: 8 }}>
                    {correlationResult.entities.slice(0, 100).map((item) => (
                      <Tag key={`${item.type}-${item.role || ''}-${item.value}`}>
                        {item.type}{item.role ? `(${item.role})` : ''}: {item.value} / {item.jobIds.map((id) => `#${id}`).join('、')}
                      </Tag>
                    ))}
                  </Space>
                </div>
                <div>
                  <Text strong>证据关系：</Text>
                  <Space wrap style={{ marginLeft: 8 }}>
                    {correlationResult.relations
                      .filter((item) => item.relation !== 'co_occurs_with')
                      .slice(0, 100)
                      .map((item, index) => (
                        <Tag key={`${index}-${item.source.type}-${item.target.type}`} color="geekblue">
                          {item.source.type}:{item.source.normalizedValue} → {item.relation} → {item.target.type}:{item.target.normalizedValue}
                        </Tag>
                      ))}
                  </Space>
                </div>
              </Space>
            </Card>
          )}

          {investigationResult && (
            <Card title="AI 调查结论">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color="blue">{investigationResult.model}</Tag>
                  <Tag>{investigationResult.planVersion}</Tag>
                  <Tag color={investigationResult.answer.confidence === 'high' ? 'green' : investigationResult.answer.confidence === 'medium' ? 'gold' : 'default'}>
                    置信度 {investigationResult.answer.confidence}
                  </Tag>
                  <Tag color="purple">{investigationResult.plan.rangeMinutes} 分钟</Tag>
                  <Tag>{investigationResult.plan.serviceName || '未限定服务'}</Tag>
                  {investigationResult.execution && (
                    <Tag color={investigationResult.execution.used.includes('direct') && investigationResult.execution.requested === 'mcp' ? 'gold' : 'cyan'}>
                      执行器 {investigationResult.execution.used.join(' + ') || investigationResult.execution.requested}
                    </Tag>
                  )}
                </Space>
                {investigationResult.execution?.fallbackReasons?.length ? (
                  <Alert type="warning" showIcon message="Grafana MCP 调用失败，本次调查使用了直连回退" description={investigationResult.execution.fallbackReasons.join('；')} />
                ) : null}
                <Alert
                  type={investigationResult.answer.insufficientEvidence ? 'warning' : 'success'}
                  showIcon
                  message={investigationResult.answer.summary}
                  description={investigationResult.answer.insufficientEvidence ? '当前结论不能作为故障根因判断，请缩小范围、补充服务或调查线索后重试。' : undefined}
                />
                {investigationResult.answer.findings.length > 0 && (
                  <div>
                    <Text strong>证据发现：</Text>
                    <ul>
                      {investigationResult.answer.findings.map((finding, index) => (
                        <li key={`${index}-${finding.text}`}>
                          {finding.text} <Text type="secondary">[{finding.evidenceIds.join('、')}]</Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {investigationResult.rounds?.length ? (
                  <div>
                    <Text strong>Agent 调查轮次：</Text>
                    <ul>
                      {investigationResult.rounds.map((round) => (
                        <li key={round.round}>
                          第 {round.round} 轮：
                          {round.reason || '根据已有证据继续追踪'}； 线索 {round.queryTexts.join('、') || '-'}；新增证据 {round.newEvidenceCount} 条
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {investigationResult.queryStatistics?.length ? (
                  <div>
                    <Text strong>查询统计：</Text>
                    <ul>
                      {investigationResult.queryStatistics.map((item, index) => (
                        <li key={`${index}-${item.queryTexts.join('-')}`}>
                          {item.serviceName || '未限定服务'} / {item.queryTexts.join(' + ') || '全部日志'}： 命中 {item.matchingLines === null ? '暂不可用' : item.matchingLines} 条， 展示证据{' '}
                          {item.sampledLines} 条{item.truncated ? '（证据已截断）' : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {investigationResult.categoryStatistics?.length ? (
                  <div>
                    <Text strong>行为分类统计：</Text>
                    <Space wrap style={{ marginLeft: 8 }}>
                      {investigationResult.categoryStatistics.map((item) => (
                        <Tag key={item.key} color={(item.matchingLines || 0) > 0 ? 'volcano' : 'default'}>
                          {item.label}：{item.matchingLines === null ? '不可用' : item.matchingLines}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                ) : null}
                {investigationResult.entities?.length ? (
                  <div>
                    <Text strong>证据实体：</Text>
                    <Space wrap style={{ marginLeft: 8 }}>
                      {investigationResult.entities.slice(0, 50).map((item) => (
                        <Tag key={`${item.type}-${item.value}`}>
                          {item.type}: {item.value} ({item.evidenceIds.length})
                        </Tag>
                      ))}
                    </Space>
                  </div>
                ) : null}
                <Text type="secondary">
                  调查意图：{investigationResult.plan.intent}；线索：
                  {investigationResult.plan.queryTexts.join('、') || '-'}
                  ；引用证据：
                  {investigationResult.answer.evidenceIds.join('、') || '-'}
                </Text>
                <Space wrap>
                  {investigationResult.exploreUrls.map((url, index) => (
                    <Button key={url} href={url} target="_blank" rel="noreferrer">
                      在 Grafana 查看查询 {index + 1}
                    </Button>
                  ))}
                </Space>
                <Table
                  size="small"
                  rowKey="evidenceId"
                  dataSource={investigationResult.evidence}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  columns={[
                    { title: '时间', dataIndex: 'timestamp', width: 210 },
                    {
                      title: '服务',
                      width: 220,
                      render: (_: unknown, row: LogEvidence) => row.labels.service_name || row.labels.app || '-',
                    },
                    {
                      title: 'Evidence ID',
                      dataIndex: 'evidenceId',
                      width: 190,
                    },
                    {
                      title: '日志内容',
                      dataIndex: 'line',
                      render: (value: string) => (
                        <Text
                          code
                          style={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                          }}
                        >
                          {value}
                        </Text>
                      ),
                    },
                  ]}
                />
              </Space>
            </Card>
          )}
        </>
      )}

      {mode === 'sql' && (
        <>
          <Card
            title={
              <Space size={6} align="center">
                <span>AI SQL 助手（受控）</span>
                <InlineHelpTooltip
                  ariaLabel="AI SQL 使用说明"
                  content="当前仅支持 SQL 预览与分析，不在 dashboard 内执行 SQL。页面中的 SQL 结果仅作为草稿建议；任何真实变更请在外部系统（如 abd.com）完成，并执行人工复核。"
                />
              </Space>
            }
          >
            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item label="自然语言问题" name="question" rules={[{ required: false }]}>
                <TextArea rows={3} placeholder="示例：查询最近 1 小时失败订单前 20 条" />
              </Form.Item>

              <Form.Item label="或直接输入 SQL" name="sql" rules={[{ required: false }]}>
                <TextArea rows={5} placeholder="示例：SELECT * FROM tbl_user LIMIT 20" />
              </Form.Item>

              <Space>
                <Button onClick={onPreview} loading={loading}>
                  预览 SQL
                </Button>
                <Button onClick={onLoadAudit} loading={loading}>
                  刷新审计
                </Button>
              </Space>
            </Form>
          </Card>

          {preview && (
            <Card title="预览结果">
              <p>
                <Text strong>来源：</Text>
                {preview.source}
              </p>
              <p>
                <Text strong>预览 SQL：</Text>
              </p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{preview.executedSql}</pre>
              <p>
                {typeof preview.appliedLimit === 'number' && <Tag color="blue">LIMIT {preview.appliedLimit}</Tag>}
                <Tag color="purple">超时 {preview.timeoutMs}ms</Tag>
                {preview.sqlType && <Tag color="geekblue">类型 {preview.sqlType}</Tag>}
                {preview.riskLevel && (
                  <Tag color={preview.riskLevel === 'critical' ? 'red' : preview.riskLevel === 'high' ? 'volcano' : preview.riskLevel === 'medium' ? 'gold' : 'green'}>风险 {preview.riskLevel}</Tag>
                )}
              </p>
              <Alert type="warning" showIcon message="仅草稿预览，未执行" description="请勿直接将结果视作已生效变更。若需执行，请在外部系统完成审批与复核。" />
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
                  render: (value: string) => <Tag color={value === 'previewed' ? 'blue' : value === 'error' ? 'red' : 'default'}>{value}</Tag>,
                },
                {
                  title: 'SQL类型',
                  dataIndex: 'sql_type',
                  width: 100,
                  render: (value?: string) => (value ? <Tag color="geekblue">{value}</Tag> : '-'),
                },
                {
                  title: '风险',
                  dataIndex: 'risk_level',
                  width: 100,
                  render: (value?: string) => {
                    if (!value) return '-';
                    const color = value === 'critical' ? 'red' : value === 'high' ? 'volcano' : value === 'medium' ? 'gold' : 'green';
                    return <Tag color={color}>{value}</Tag>;
                  },
                },
                { title: '问题', dataIndex: 'question', ellipsis: true },
                { title: '返回行数', dataIndex: 'row_count', width: 100 },
                { title: '时间', dataIndex: 'created_at', width: 180 },
              ]}
            />
          </Card>
        </>
      )}
    </Space>
  );
};

export default AiOpsPage;
