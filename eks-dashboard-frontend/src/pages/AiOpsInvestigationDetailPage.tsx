import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input, Select, Space, Table, Tag, Timeline, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { addAiOpsInvestigationFeedback, getAiOpsInvestigation, type AiOpsInvestigation } from '../services/api';
import { PageHeader, StatusBadge } from '../components/ops';

const jsonText = (value: unknown) => { try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2); } catch { return String(value || ''); } };

const AiOpsInvestigationDetailPage: React.FC = () => {
  const { id } = useParams(); const navigate = useNavigate(); const { message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [item, setItem] = useState<AiOpsInvestigation>(); const [loading, setLoading] = useState(false); const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [form] = Form.useForm();
  const load = useCallback(async () => { const numericId = Number(id); if (!currentEnvironment?.id || !Number.isInteger(numericId)) return; setLoading(true); try { setItem(await getAiOpsInvestigation(currentEnvironment.id, numericId)); } catch (err: unknown) { message.error((err as ApiError)?.response?.data?.message || '调查详情加载失败'); } finally { setLoading(false); } }, [currentEnvironment?.id, id, message]);
  useEffect(() => { setItem(undefined); if (currentEnvironment?.id) void load(); }, [currentEnvironment?.id, load]);
  const report = useMemo(() => { if (!item?.report_json) return undefined; try { return typeof item.report_json === 'string' ? JSON.parse(item.report_json) : item.report_json; } catch { return undefined; } }, [item]);
  const submitFeedback = async (values: { rating: string; comment?: string }) => { if (!item || !currentEnvironment?.id) return; setFeedbackLoading(true); try { await addAiOpsInvestigationFeedback(currentEnvironment.id, item.id, values.rating, values.comment); message.success('反馈已记录'); form.resetFields(); await load(); } finally { setFeedbackLoading(false); } };
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <PageHeader title={item?.alert_name || 'AI 调查详情'} description="结论为 AI 初步调查结果；事实、候选判断和缺失证据分开呈现。" environmentName={currentEnvironment?.name} actions={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ai-ops')}>返回调查列表</Button>} />
    {loading && <Card loading />}
    {item && <>
      <Card><Descriptions bordered size="small" column={2}><Descriptions.Item label="状态"><StatusBadge status={item.status} /></Descriptions.Item><Descriptions.Item label="来源"><Tag color={item.source_type === 'HISTORICAL_REPLAY' ? 'purple' : undefined}>{item.source_type === 'HISTORICAL_REPLAY' ? '历史回放' : item.source_type}</Tag></Descriptions.Item><Descriptions.Item label="级别">{item.severity || '-'}</Descriptions.Item><Descriptions.Item label="分类">{item.classification || '-'}</Descriptions.Item><Descriptions.Item label="服务">{item.service_name || '-'}</Descriptions.Item><Descriptions.Item label="Namespace">{item.namespace || '-'}</Descriptions.Item><Descriptions.Item label="开始时间">{item.source_started_at}</Descriptions.Item><Descriptions.Item label="置信度">{item.confidence || '-'}</Descriptions.Item></Descriptions></Card>
      <Alert type={item.insufficient_evidence ? 'warning' : 'success'} showIcon message={item.summary || '暂无摘要'} description={item.insufficient_evidence ? '当前报告缺少完整指标、Kubernetes、日志或发布证据，不能视作已确认根因。' : undefined} />
      {report && <Card title="通用告警报告"><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{jsonText(report)}</pre></Card>}
      <Card title="调查步骤"><Timeline items={(item.steps || []).map((step) => ({ color: step.status === 'COMPLETED' ? 'green' : step.status === 'FAILED' ? 'red' : 'blue', children: `${step.step_key} · ${step.status}${step.summary ? ` — ${step.summary}` : ''}` }))} /></Card>
      <Card title="证据"><Table rowKey="evidence_id" size="small" pagination={false} dataSource={item.evidence || []} columns={[{ title: 'Evidence ID', dataIndex: 'evidence_id', width: 210 }, { title: '类型', dataIndex: 'evidence_type', width: 140 }, { title: '时间', dataIndex: 'observed_at', width: 180 }, { title: '内容', dataIndex: 'content_json', render: (value) => <Typography.Text code style={{ whiteSpace: 'pre-wrap' }}>{jsonText(value)}</Typography.Text> }, { title: '来源', dataIndex: 'source_url', width: 100, render: (value) => value ? <a href={value} target="_blank" rel="noreferrer">查看</a> : '-' }]} /></Card>
      <Card title="人工反馈"><Form form={form} layout="inline" onFinish={submitFeedback}><Form.Item name="rating" rules={[{ required: true }]}><Select placeholder="评价" style={{ width: 190 }} options={[{ value: 'EFFECTIVE', label: '有效' }, { value: 'PARTIAL', label: '部分有效' }, { value: 'INEFFECTIVE', label: '无效' }, { value: 'INSUFFICIENT_EVIDENCE', label: '证据不足' }]} /></Form.Item><Form.Item name="comment"><Input placeholder="备注（可选）" style={{ width: 360 }} /></Form.Item><Button type="primary" htmlType="submit" loading={feedbackLoading}>提交反馈</Button></Form></Card>
    </>}
  </Space>;
};

export default AiOpsInvestigationDetailPage;
