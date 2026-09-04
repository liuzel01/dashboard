import { useContext, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, Modal, Select, Skeleton, Space, Steps, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AuthContext } from '../contexts/AuthContext';
import { createMonitoringRequest, decideMonitoringRequest, getMonitoringRequest, listMonitoringRequests, submitMonitoringRequest, submitManagedMonitoringRequest, withdrawMonitoringRequest, startMonitoringJenkinsExecution, listMonitoringJenkinsExecutions, refreshMonitoringJenkinsExecution } from '../services/api';
import type { MonitoringJenkinsExecution, MonitoringRequest, MonitoringRequestStatus } from '../services/api';

const { Text, Paragraph } = Typography;
const colors: Record<MonitoringRequestStatus, string> = { DRAFT: 'default', SUBMITTED: 'processing', APPROVED: 'success', COMPLETED: 'cyan', REJECTED: 'error', WITHDRAWN: 'default' };
const names: Record<MonitoringRequestStatus, string> = { DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准', COMPLETED: '已完成', REJECTED: '已拒绝', WITHDRAWN: '已撤回' };
const eventNames: Record<string, string> = { CREATED: '已创建草稿', DRAFT_UPDATED: '已更新草稿', SUBMITTED: '已提交审批', APPROVED: '已批准', COMPLETED: '已完成', REJECTED: '已拒绝', WITHDRAWN: '已撤回', PREVIEW_QUEUED: '已发起最终 Diff 预检', PREVIEW_SUCCEEDED: '最终 Diff 预检成功', PREVIEW_FAILED: '最终 Diff 预检失败', REAL_APPLY_GRANTED: '已签发真实执行授权', REAL_APPLY_QUEUED: '已发起真实执行', REAL_APPLY_SUCCEEDED: '真实执行成功并完成申请', REAL_APPLY_FAILED: '真实执行失败', GITLAB_MERGED: 'GitLab 已受控合并（生成最终 Diff 前）', GITLAB_MERGE_FAILED: 'GitLab 合并失败', GITLAB_MR_CREATED: 'Dashboard 已创建 GitLab MR', GITLAB_MR_CREATE_FAILED: 'Dashboard 创建 GitLab MR 失败' };
const auditStatus = (status?: string | null) => status && names[status as MonitoringRequestStatus] ? names[status as MonitoringRequestStatus] : (status || '—');
const statusTag = (s: MonitoringRequestStatus) => <Tag color={colors[s]}>{names[s]}</Tag>;
const resourceOptions = ['ServiceMonitor', 'PrometheusRule'] as const;
const beijingTime = (value?: string | null) => {
  if (!value) return '—';
  // API uses UTC DATETIME strings (mysql dateStrings=true), which have no offset.
  // Make that UTC contract explicit before formatting; otherwise browsers parse them
  // in their local zone and UTC+9 clients show a one-hour-early Beijing time.
  const utc = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(utc)).replaceAll('/', '-');
};

export default function MonitoringRequestsPage() {
  const { me, permissions } = useContext(AuthContext); const [items, setItems] = useState<MonitoringRequest[]>([]); const [loading, setLoading] = useState(false); const [createOpen, setCreateOpen] = useState(false); const [detailOpen, setDetailOpen] = useState(false); const [detailLoading, setDetailLoading] = useState(false); const [detail, setDetail] = useState<MonitoringRequest | null>(null); const [form] = Form.useForm();
  const selectedResourceType = Form.useWatch<'ServiceMonitor' | 'PrometheusRule' | undefined>('resourceType', form);
  const selectedAppId = Form.useWatch<string | undefined>('appId', form);
  const canApprove = permissions.includes('monitoring-requests:approve');
  const [executions, setExecutions] = useState<MonitoringJenkinsExecution[]>([]);
  const [executionLoading, setExecutionLoading] = useState(false);
  const load = async () => { setLoading(true); try { setItems((await listMonitoringRequests()).items); } catch (e: any) { message.error(e?.response?.data?.message || '加载申请失败'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const openDetail = async (id: string) => { setDetailOpen(true); setDetailLoading(true); setDetail(null); setExecutions([]); try { const [request, initialRuns] = await Promise.all([getMonitoringRequest(id), listMonitoringJenkinsExecutions(id)]); const staleRuns = initialRuns.filter(run => !['SUCCESS', 'FAILURE', 'ABORTED'].includes(run.status) || (run.mode === 'preview' && run.status === 'SUCCESS' && !run.diff_text)); if (staleRuns.length) await Promise.all(staleRuns.map(run => refreshMonitoringJenkinsExecution(id, run.id))); const runs = staleRuns.length ? await listMonitoringJenkinsExecutions(id) : initialRuns; const refreshedRequest = staleRuns.length ? await getMonitoringRequest(id) : request; setDetail(refreshedRequest); setExecutions(runs); } catch (e: any) { message.error(e?.response?.data?.message || '加载详情失败'); } finally { setDetailLoading(false); } };
  const create = async () => { try { const values = await form.validateFields(); const row = await createMonitoringRequest(values); message.success('草稿已创建'); setCreateOpen(false); form.resetFields(); await load(); await openDetail(row.request_id); } catch (e: any) { if (e?.errorFields) return; message.error(e?.response?.data?.message || '创建失败'); } };
  // These confirmations originate from inside a Drawer (z-index 1000). Raise the
  // static modal so its mask/panel remain clickable instead of being obscured.
  const submit = () => {
    let modal: ReturnType<typeof Modal.confirm>;
    modal = Modal.confirm({
      title: '提交审批', zIndex: 1100, closable: true, maskClosable: true, footer: null,
      content: <SubmitForm onDone={async (data) => {
        if (!detail) return;
        try {
          await submitMonitoringRequest(detail.request_id, data);
          modal.destroy();
          message.success('已提交审批');
          await load();
          await openDetail(detail.request_id);
        } catch (e: any) {
          message.error(e?.response?.data?.message || '提交失败');
          throw e;
        }
      }} />,
    });
  };
  const managedSubmit = async () => { if (!detail) return; setExecutionLoading(true); try { await submitManagedMonitoringRequest(detail.request_id); message.success('已创建受控 GitLab MR 并提交审批'); await load(); await openDetail(detail.request_id); } catch (e: any) { message.error(e?.response?.data?.message || '创建受控 GitLab MR 失败'); } finally { setExecutionLoading(false); } };
  const action = async (kind: 'approve'|'reject'|'withdraw') => { if (!detail) return; const label = kind === 'approve' ? '批准' : kind === 'reject' ? '拒绝' : '撤回'; Modal.confirm({ title: `确认${label}`, zIndex: 1100, content: `该操作会记录审计事件。${kind === 'approve' ? '批准仅绑定当前 MR IID 与 Commit SHA；后续 SHA 变更必须重新提交。' : ''}`, onOk: async () => { try { if (kind === 'withdraw') await withdrawMonitoringRequest(detail.request_id); else await decideMonitoringRequest(detail.request_id, kind); message.success(`已${label}`); await load(); await openDetail(detail.request_id); } catch (e: any) { message.error(e?.response?.data?.message || `${label}失败`); throw e; } } }); };
  const latestPreview = executions.find(e => e.mode === 'preview' && e.status === 'SUCCESS' && !!e.diff_text);
  const execution = async (mode: 'preview'|'apply') => { if (!detail) return; const label = mode === 'preview' ? '确认合并并生成最终 Diff' : '确认真实执行'; let comment = ''; let confirmation = ''; Modal.confirm({ title: label, zIndex: 1100, closable: true, maskClosable: true, width: 680, okText: mode === 'preview' ? '确认合并并生成 Diff' : '确认真实执行', content: mode === 'preview' ? <FinalDiffConfirmation detail={detail} /> : <Space direction="vertical" style={{ width: '100%' }}><Alert type="warning" showIcon message="将基于当前最终 Diff 触发 DRY_RUN=false。Jenkins 会再次校验 MR、SHA 和资源策略；授权仅 15 分钟有效且只能消费一次。" /><Input.TextArea rows={3} placeholder="确认说明（必填）" onChange={e => { comment = e.target.value; }} /><Input placeholder="输入 APPLY 以确认" onChange={e => { confirmation = e.target.value; }} /></Space>, onOk: async () => { try { if (mode === 'apply' && (confirmation !== 'APPLY' || !comment.trim())) { message.error('请输入 APPLY 并填写确认说明'); throw new Error('confirmation required'); } setExecutionLoading(true); const run = await startMonitoringJenkinsExecution(detail.request_id, mode, { comment, confirmation }); message.success(`${label}已进入 Jenkins 队列 #${run.queue_id}`); await openDetail(detail.request_id); } catch (e: any) { if (e?.message === 'confirmation required') return; message.error(e?.response?.data?.message || `${label}失败`); throw e; } finally { setExecutionLoading(false); } } }); };
  const refreshRuns = async () => { if (!detail) return; try { setExecutionLoading(true); for (const run of executions.filter(e => !['SUCCESS','FAILURE','ABORTED'].includes(e.status))) await refreshMonitoringJenkinsExecution(detail.request_id, run.id); await openDetail(detail.request_id); } catch (e: any) { message.error(e?.response?.data?.message || '刷新执行状态失败'); } finally { setExecutionLoading(false); } };
  const columns: ColumnsType<MonitoringRequest> = [
    { title: '申请 ID', dataIndex: 'request_id', width: 230, render: (v) => <Button type="link" onClick={() => void openDetail(v)}>{v}</Button> },
    { title: '资源', render: (_, r) => <><div>{r.resource_type}/{r.resource_name}</div><Text type="secondary">{r.app_id}</Text></> },
    { title: '状态', dataIndex: 'status', render: statusTag },
    { title: '申请人', dataIndex: 'requester_display_name', render: (_, r) => r.requester_display_name || r.requester_username },
    { title: '更新时间', dataIndex: 'updated_at', width: 180, render: beijingTime },
  ];
  const mine = detail && Number(detail.requester_user_id) === Number(me?.id);
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title="监控资源申请与审批" extra={<Button type="primary" onClick={() => setCreateOpen(true)}>新建申请</Button>}>
      <Alert type="info" showIcon message="当前一期仅开放 ServiceMonitor 与 PrometheusRule。PrometheusRule 走固定 YAML 与结构化字段，不支持 PodMonitor，也不修改 Alertmanager 路由。" style={{ marginBottom: 16 }} />
      <Table rowKey="request_id" loading={loading} columns={columns} dataSource={items} pagination={false} />
    </Card>
    <Modal title="新建监控资源申请" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} okText="创建草稿" destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ resourceType: 'ServiceMonitor' }}>
        <Form.Item name="appId" label="应用 ID" rules={[{ required: true, pattern: /^[a-z][a-z0-9-]{1,62}$/, message: '小写字母开头，仅小写字母、数字和连字符' }]}>
          <Input placeholder="dashboard-chain-test" />
        </Form.Item>
        <Form.Item name="resourceType" label="资源类型" rules={[{ required: true }]}>
          <Select options={resourceOptions.map(value => ({ value }))} />
        </Form.Item>
        {selectedResourceType !== 'PrometheusRule' ? (
          <Form.Item name="resourceName" label="资源名称" rules={[{ required: true, pattern: /^[a-z][a-z0-9-]{1,62}$/ }]}>
            <Input placeholder={selectedAppId ? `${selectedAppId}-metrics` : 'dashboard-chain-test-metrics'} />
          </Form.Item>
        ) : (
          <Form.Item label="资源名称">
            <Input value={selectedAppId ? `${selectedAppId}-platform-rules` : ''} disabled placeholder="自动生成：<appId>-platform-rules" />
          </Form.Item>
        )}
        <Form.Item name="reason" label="申请说明" rules={[{ required: true, max: 1000 }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        {selectedResourceType === 'PrometheusRule' && <PrometheusRuleFieldsForm />}
      </Form>
    </Modal>
    <Drawer title={detail?.request_id || '申请详情'} open={detailOpen} onClose={() => { setDetailOpen(false); setDetail(null); setExecutions([]); }} width={720}>
      {detailLoading && !detail ? <Skeleton active paragraph={{ rows: 10 }} /> : detail && <Space direction="vertical" size={16} style={{ width: '100%' }}><Descriptions bordered column={1} size="small"><Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item><Descriptions.Item label="受控路径"><Text code>{detail.resource_path}</Text></Descriptions.Item><Descriptions.Item label="资源">{detail.resource_type}/{detail.resource_name}</Descriptions.Item><Descriptions.Item label="申请说明">{detail.reason}</Descriptions.Item><Descriptions.Item label="GitLab 绑定">{detail.mr_iid ? `MR !${detail.mr_iid} @ ${detail.commit_sha}${detail.gitlab_merged_at ? '（已受控合并）' : ''}` : '尚未提交'}</Descriptions.Item><Descriptions.Item label="审批信息">{detail.approver_username ? `${detail.approver_username}${detail.approval_comment ? `：${detail.approval_comment}` : ''}` : '-'}</Descriptions.Item></Descriptions>
        {detail.resource_type === 'PrometheusRule' && <Descriptions bordered column={1} size="small"><Descriptions.Item label="告警名">{detail.prometheus_rule_alert_name}</Descriptions.Item><Descriptions.Item label="Severity">{detail.prometheus_rule_severity}</Descriptions.Item><Descriptions.Item label="For">{detail.prometheus_rule_for}</Descriptions.Item><Descriptions.Item label="Owner">{detail.prometheus_rule_owner}</Descriptions.Item><Descriptions.Item label="Runbook">{detail.prometheus_rule_runbook_url}</Descriptions.Item><Descriptions.Item label="Summary">{detail.prometheus_rule_summary}</Descriptions.Item><Descriptions.Item label="Description">{detail.prometheus_rule_description}</Descriptions.Item><Descriptions.Item label="Expr"><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.prometheus_rule_expr}</pre></Descriptions.Item></Descriptions>}
        {detail.status === 'COMPLETED' && <Alert type="success" showIcon message="真实执行已完成" description={`Jenkins #${executions.find(e => e.mode === 'apply' && e.status === 'SUCCESS')?.build_number || '—'} 已成功完成。该申请已进入终态，不可再次预检、执行、撤回或重新提交。`} />}<Space wrap>{mine && detail.status === 'DRAFT' && !detail.mr_iid && !detail.commit_sha && <><Button type="primary" loading={executionLoading} onClick={() => void managedSubmit()}>创建 MR 并提交</Button>{detail.resource_type === 'ServiceMonitor' && <Button disabled={executionLoading} onClick={submit}>手工绑定 MR</Button>}</>}{mine && ['DRAFT','SUBMITTED','REJECTED'].includes(detail.status) && <Button onClick={() => void action('withdraw')}>撤回</Button>}{canApprove && !mine && detail.status === 'SUBMITTED' && <><Button type="primary" onClick={() => void action('approve')}>批准</Button><Button danger onClick={() => void action('reject')}>拒绝</Button></>}{detail.status === 'APPROVED' && <Button loading={executionLoading} onClick={() => void execution('preview')}>{detail.gitlab_merged_at ? '生成最终 Diff' : '确认合并并生成最终 Diff'}</Button>}{canApprove && !mine && detail.status === 'APPROVED' && <Button type="primary" danger disabled={!latestPreview} loading={executionLoading} onClick={() => void execution('apply')}>确认真实执行</Button>}{!['WITHDRAWN','COMPLETED'].includes(detail.status) && <Button loading={executionLoading} onClick={() => void refreshRuns()}>刷新执行状态</Button>}</Space>
        <Card size="small" title="Jenkins 受控执行">{executions.length ? <Space direction="vertical" style={{ width: '100%' }}>{executions.map(run => <Card key={run.id} size="small" title={`${run.mode === 'preview' ? '最终 Diff 预检' : '真实执行'} #${run.build_number || `队列 ${run.queue_id}`}`} extra={<Tag color={run.status === 'SUCCESS' ? 'success' : run.status === 'FAILURE' ? 'error' : 'processing'}>{run.status}</Tag>}><Text type="secondary">MR !{run.mr_iid} @ {run.commit_sha} · {beijingTime(run.created_at)}</Text>{run.diff_text && <><Paragraph strong style={{ marginTop: 12 }}>最终 server-side Diff（仅当前绑定 SHA 有效）</Paragraph><pre style={{ maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>{run.diff_text}</pre></>}</Card>)}</Space> : <Text type="secondary">尚未生成最终 Diff。</Text>}</Card>
        <Card size="small" title="状态流转审计"><Steps direction="vertical" size="small" current={Math.max(0, (detail.events || []).length - 1)} items={(detail.events || []).map(e => ({ title: <><Text strong>{eventNames[e.event_type] || e.event_type}</Text>{e.to_status && <Tag color={colors[e.to_status as MonitoringRequestStatus]} style={{ marginInlineStart: 8 }}>{auditStatus(e.to_status)}</Tag>}</>, description: <>{auditStatus(e.from_status)} → {auditStatus(e.to_status)} · {e.actor_username} · {beijingTime(e.created_at)}{e.comment ? ` · ${e.comment}` : ''}</> }))} /></Card>
      </Space>}
    </Drawer>
  </Space>;
}
function SubmitForm({ onDone }: { onDone: (data: { mrIid: number; commitSha: string }) => Promise<void> }) {
  const [form] = Form.useForm(); const [submitting, setSubmitting] = useState(false);
  const submit = async (v: { mrIid: number; commitSha: string }) => { setSubmitting(true); try { await onDone({ ...v, mrIid: Number(v.mrIid) }); } catch { /* parent has shown the request error; retain the form for correction */ } finally { setSubmitting(false); } };
  return <Form form={form} layout="vertical" onFinish={submit}>
    <Paragraph type="secondary">兼容入口：仅用于已在 GitLab 创建的受控 MR。新申请请优先使用“创建 MR 并提交”。</Paragraph>
    <Form.Item name="mrIid" label="GitLab MR IID" rules={[{ required: true, message: '请输入 MR IID' }, { validator: (_, value) => Number.isInteger(Number(value)) && Number(value) >= 1 ? Promise.resolve() : Promise.reject(new Error('MR IID 必须是大于等于 1 的整数')) }]}>
      <Input type="number" min={1} step={1} />
    </Form.Item>
    <Form.Item name="commitSha" label="Commit SHA" rules={[{ required: true, pattern: /^[a-f0-9]{40}$/i, message: '需要完整 40 位 SHA' }]}><Input /></Form.Item>
    <Button htmlType="submit" type="primary" loading={submitting} disabled={submitting}>确认提交</Button>
  </Form>;
}

function PrometheusRuleFieldsForm() {
  return <Space direction="vertical" style={{ width: '100%' }} size={0}>
    <Alert type="warning" showIcon message="PrometheusRule 当前一期为固定模板" description="固定生成一个 `platform.<appId>.alerts` group 和单条 alert 规则；不支持 PodMonitor、任意 YAML 或 Alertmanager 路由修改。" style={{ marginBottom: 16 }} />
    <Form.Item name={['prometheusRule', 'alertName']} label="告警名" rules={[{ required: true, pattern: /^[A-Z][A-Za-z0-9_:]{2,127}$/, message: '大写字母开头，仅允许字母、数字、下划线、冒号' }]}>
      <Input placeholder="DashboardChainTestDown" />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'severity']} label="Severity" rules={[{ required: true }]}>
      <Select options={['warning', 'critical'].map(value => ({ value }))} />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'forDuration']} label="触发持续时间" rules={[{ required: true, pattern: /^([1-9][0-9]*)(s|m|h|d|w)$/, message: '示例：5m、10m、1h' }]}>
      <Input placeholder="5m" />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'owner']} label="Owner" rules={[{ required: true, max: 64 }]}>
      <Input placeholder="platform-oncall" />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'runbookUrl']} label="Runbook URL" rules={[{ required: true, type: 'url', message: '请输入有效 URL' }]}>
      <Input placeholder="https://runbook.example.com/dashboard-chain-test" />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'summary']} label="Summary" rules={[{ required: true, max: 240 }]}>
      <Input />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'description']} label="Description" rules={[{ required: true, max: 1000 }]}>
      <Input.TextArea rows={3} />
    </Form.Item>
    <Form.Item name={['prometheusRule', 'expr']} label="PromQL Expr" rules={[{ required: true, max: 600 }]}>
      <Input.TextArea rows={5} placeholder={'kube_deployment_status_replicas_available{namespace="default",deployment="dashboard-chain-test"} < 1'} />
    </Form.Item>
  </Space>;
}

function FinalDiffConfirmation({ detail }: { detail: MonitoringRequest }) {
  const alreadyMerged = !!detail.gitlab_merged_at && detail.gitlab_merge_commit_sha === detail.commit_sha;
  return <Space direction="vertical" size={14} style={{ width: '100%' }}>
    <Alert type={alreadyMerged ? 'info' : 'warning'} showIcon message={alreadyMerged ? '将基于已受控合并的 commit 生成最终 Diff' : '此操作将先受控合并 GitLab MR，再生成最终 Diff'} description={alreadyMerged ? '不会再次合并 MR；Jenkins 将仅对下列已合并 commit 执行 DRY_RUN=true。' : '这不是纯预检：确认后 Dashboard Bot 会合并下列 MR。合并成功后，Jenkins 才会对回读到的 merge commit 执行 DRY_RUN=true。'} />
    <Descriptions bordered size="small" column={1}>
      <Descriptions.Item label="申请 ID"><Text code>{detail.request_id}</Text></Descriptions.Item>
      <Descriptions.Item label="GitLab MR"><Text strong>!{detail.mr_iid}</Text></Descriptions.Item>
      <Descriptions.Item label={alreadyMerged ? '已验证 merge commit' : '当前绑定 source SHA'}><Text code>{detail.commit_sha || '—'}</Text></Descriptions.Item>
      <Descriptions.Item label="申请标记"><Text code>{`Dashboard-Request-ID: ${detail.request_id}`}</Text></Descriptions.Item>
      <Descriptions.Item label="资源">{detail.resource_type}/{detail.resource_name}（{detail.app_id}）</Descriptions.Item>
      <Descriptions.Item label="受控路径"><Text code>{detail.resource_path}</Text></Descriptions.Item>
    </Descriptions>
    <Alert type="info" showIcon message="后端受控校验" description={<ul style={{ margin: 0, paddingInlineStart: 18 }}><li>MR 的目标分支必须与 SiteConf 配置完全一致。</li><li>MR 当前 SHA 必须等于上述绑定 source SHA，描述必须含上述申请标记。</li><li>MR 仅可为 Open，或为同一绑定关系下已合并的幂等重试。</li><li>合并后必须回读到 merged 状态、有效 merge commit SHA 与合并时间；任一不符即拒绝，不触发 Jenkins。</li></ul>} />
  </Space>;
}
