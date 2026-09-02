import { useContext, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, Modal, Select, Space, Steps, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AuthContext } from '../contexts/AuthContext';
import { createMonitoringRequest, decideMonitoringRequest, getMonitoringRequest, listMonitoringRequests, submitMonitoringRequest, withdrawMonitoringRequest } from '../services/api';
import type { MonitoringRequest, MonitoringRequestStatus } from '../services/api';

const { Text, Paragraph } = Typography;
const colors: Record<MonitoringRequestStatus, string> = { DRAFT: 'default', SUBMITTED: 'processing', APPROVED: 'success', REJECTED: 'error', WITHDRAWN: 'default' };
const names: Record<MonitoringRequestStatus, string> = { DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准', REJECTED: '已拒绝', WITHDRAWN: '已撤回' };
const statusTag = (s: MonitoringRequestStatus) => <Tag color={colors[s]}>{names[s]}</Tag>;

export default function MonitoringRequestsPage() {
  const { me, permissions } = useContext(AuthContext); const [items, setItems] = useState<MonitoringRequest[]>([]); const [loading, setLoading] = useState(false); const [createOpen, setCreateOpen] = useState(false); const [detail, setDetail] = useState<MonitoringRequest | null>(null); const [form] = Form.useForm();
  const canApprove = permissions.includes('monitoring-requests:approve');
  const load = async () => { setLoading(true); try { setItems((await listMonitoringRequests()).items); } catch (e: any) { message.error(e?.response?.data?.message || '加载申请失败'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const openDetail = async (id: string) => { try { setDetail(await getMonitoringRequest(id)); } catch (e: any) { message.error(e?.response?.data?.message || '加载详情失败'); } };
  const create = async () => { try { const values = await form.validateFields(); const row = await createMonitoringRequest(values); message.success('草稿已创建'); setCreateOpen(false); form.resetFields(); await load(); await openDetail(row.request_id); } catch (e: any) { if (e?.errorFields) return; message.error(e?.response?.data?.message || '创建失败'); } };
  const submit = () => Modal.confirm({ title: '提交审批', content: <SubmitForm onDone={async (data) => { if (!detail) return; await submitMonitoringRequest(detail.request_id, data); message.success('已提交审批'); await load(); await openDetail(detail.request_id); }} />, footer: null });
  const action = async (kind: 'approve'|'reject'|'withdraw') => { if (!detail) return; const label = kind === 'approve' ? '批准' : kind === 'reject' ? '拒绝' : '撤回'; Modal.confirm({ title: `确认${label}`, content: `该操作会记录审计事件。${kind === 'approve' ? '批准仅绑定当前 MR IID 与 Commit SHA；后续 SHA 变更必须重新提交。' : ''}`, onOk: async () => { if (kind === 'withdraw') await withdrawMonitoringRequest(detail.request_id); else await decideMonitoringRequest(detail.request_id, kind); message.success(`已${label}`); await load(); await openDetail(detail.request_id); } }); };
  const columns: ColumnsType<MonitoringRequest> = [
    { title: '申请 ID', dataIndex: 'request_id', width: 230, render: (v) => <Button type="link" onClick={() => void openDetail(v)}>{v}</Button> },
    { title: '资源', render: (_, r) => <><div>{r.resource_type}/{r.resource_name}</div><Text type="secondary">{r.app_id}</Text></> },
    { title: '状态', dataIndex: 'status', render: statusTag },
    { title: '申请人', dataIndex: 'requester_display_name', render: (_, r) => r.requester_display_name || r.requester_username },
    { title: '更新时间', dataIndex: 'updated_at', width: 180 },
  ];
  const mine = detail && Number(detail.requester_user_id) === Number(me?.id);
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title="监控资源申请与审批" extra={<Button type="primary" onClick={() => setCreateOpen(true)}>新建申请</Button>}>
      <Alert type="info" showIcon message="当前仅实现申请、审批与审计闭环。不会创建 GitLab MR、触发 Jenkins 或执行 Kubernetes apply。" style={{ marginBottom: 16 }} />
      <Table rowKey="request_id" loading={loading} columns={columns} dataSource={items} pagination={false} />
    </Card>
    <Modal title="新建监控资源申请" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void create()} okText="创建草稿" destroyOnHidden>
      <Form form={form} layout="vertical"><Form.Item name="appId" label="应用 ID" rules={[{ required: true, pattern: /^[a-z][a-z0-9-]{1,62}$/, message: '小写字母开头，仅小写字母、数字和连字符' }]}><Input placeholder="dashboard-chain-test" /></Form.Item><Form.Item name="resourceType" label="资源类型" rules={[{ required: true }]}><Select options={['ServiceMonitor','PodMonitor','PrometheusRule'].map(value => ({ value }))} /></Form.Item><Form.Item name="resourceName" label="资源名称" rules={[{ required: true, pattern: /^[a-z][a-z0-9-]{1,62}$/ }]}><Input /></Form.Item><Form.Item name="reason" label="申请说明" rules={[{ required: true, max: 1000 }]}><Input.TextArea rows={4} /></Form.Item></Form>
    </Modal>
    <Drawer title={detail?.request_id || '申请详情'} open={!!detail} onClose={() => setDetail(null)} width={720}>
      {detail && <Space direction="vertical" size={16} style={{ width: '100%' }}><Descriptions bordered column={1} size="small"><Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item><Descriptions.Item label="受控路径"><Text code>{detail.resource_path}</Text></Descriptions.Item><Descriptions.Item label="资源">{detail.resource_type}/{detail.resource_name}</Descriptions.Item><Descriptions.Item label="申请说明">{detail.reason}</Descriptions.Item><Descriptions.Item label="GitLab 绑定">{detail.mr_iid ? `MR !${detail.mr_iid} @ ${detail.commit_sha}` : '尚未提交'}</Descriptions.Item><Descriptions.Item label="审批信息">{detail.approver_username ? `${detail.approver_username}${detail.approval_comment ? `：${detail.approval_comment}` : ''}` : '-'}</Descriptions.Item></Descriptions>
        <Space wrap>{mine && ['DRAFT','REJECTED','WITHDRAWN'].includes(detail.status) && <Button type="primary" onClick={submit}>绑定 MR 并提交</Button>}{mine && ['DRAFT','SUBMITTED','REJECTED'].includes(detail.status) && <Button onClick={() => void action('withdraw')}>撤回</Button>}{canApprove && !mine && detail.status === 'SUBMITTED' && <><Button type="primary" onClick={() => void action('approve')}>批准</Button><Button danger onClick={() => void action('reject')}>拒绝</Button></>}</Space>
        <Card size="small" title="状态流转审计"><Steps direction="vertical" size="small" items={(detail.events || []).map(e => ({ title: e.event_type, description: <>{e.actor_username} · {e.created_at}{e.comment ? ` · ${e.comment}` : ''}</> }))} /></Card>
      </Space>}
    </Drawer>
  </Space>;
}
function SubmitForm({ onDone }: { onDone: (data: { mrIid: number; commitSha: string }) => Promise<void> }) { const [form] = Form.useForm(); return <Form form={form} layout="vertical" onFinish={(v) => void onDone(v)}><Paragraph type="secondary">提交前请确保 MR 目标分支为 hash-jenkins，描述包含当前申请 ID，且 SHA 是待验证的 MR HEAD。</Paragraph><Form.Item name="mrIid" label="GitLab MR IID" rules={[{ required: true }]}><Input type="number" /></Form.Item><Form.Item name="commitSha" label="Commit SHA" rules={[{ required: true, pattern: /^[a-f0-9]{40}$/i, message: '需要完整 40 位 SHA' }]}><Input /></Form.Item><Button htmlType="submit" type="primary">确认提交</Button></Form>; }
