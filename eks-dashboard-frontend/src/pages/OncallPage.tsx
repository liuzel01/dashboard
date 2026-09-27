import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input, Popconfirm, Select, Space, Table, Tag, Timeline, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { acknowledgeOncallAlert, deleteOncallRoster, getOncallAlert, listOncallAlerts, listOncallRoster, saveOncallRoster, type OncallAlert, type OncallAlertStatus, type OncallRosterBinding, type OncallRosterLevel } from '../services/api';
import { DetailDrawer, FilterBar, MetricGrid, OpsTable, PageHeader, StatusBadge } from '../components/ops';

const { Text } = Typography;

const asJsonText = (value: unknown) => {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value || {}, null, 2);
};

const OncallPage: React.FC = () => {
  const { message } = App.useApp();
  const { environments, currentEnvironment } = useContext(EnvironmentContext);
  const [items, setItems] = useState<OncallAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<OncallAlertStatus | undefined>();
  const [environmentId, setEnvironmentId] = useState<string | undefined>(currentEnvironment?.id);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<OncallAlert | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackForm] = Form.useForm();
  const [roster, setRoster] = useState<OncallRosterBinding[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);
  const [rosterForm] = Form.useForm();
  const [rosterEnvironmentId, setRosterEnvironmentId] = useState<string | undefined>(currentEnvironment?.id);
  const [editingRosterId, setEditingRosterId] = useState<number | undefined>();

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listOncallAlerts({ page: 1, pageSize: 100, status, environmentId, keyword: keyword.trim() || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (error: unknown) {
      const errorMessage = (error as ApiError)?.response?.data?.message || (error as ApiError)?.message || 'Oncall 告警加载失败';
      setLoadError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [status, environmentId]); // intentional: text search requires an explicit click

  const loadRoster = async () => {
    setRosterLoading(true);
    try { setRoster(await listOncallRoster(environmentId)); }
    catch (error: unknown) { message.error((error as ApiError)?.response?.data?.message || (error as ApiError)?.message || '值班配置加载失败'); }
    finally { setRosterLoading(false); }
  };
  useEffect(() => { void loadRoster(); }, [environmentId]);

  const editRoster = (row: OncallRosterBinding) => {
    setEditingRosterId(row.id);
    setRosterEnvironmentId(row.environment_id);
    rosterForm.setFieldsValue({ level: row.level, email: row.email, displayName: row.display_name || undefined });
  };

  const saveRoster = async (values: { level: OncallRosterLevel; email: string; displayName?: string }) => {
    setRosterSaving(true);
    try {
      await saveOncallRoster({ id: editingRosterId, environmentId: rosterEnvironmentId || currentEnvironment?.id || 'mgbx', ...values });
      message.success(editingRosterId ? '值班配置已更新' : '值班配置已保存'); rosterForm.resetFields(); setEditingRosterId(undefined); await loadRoster();
    } catch (error: unknown) { message.error((error as ApiError)?.response?.data?.message || (error as ApiError)?.message || '值班配置保存失败'); }
    finally { setRosterSaving(false); }
  };

  const removeRoster = async (id: number) => {
    try { await deleteOncallRoster(id); message.success('值班配置已删除'); await loadRoster(); }
    catch (error: unknown) { message.error((error as ApiError)?.response?.data?.message || (error as ApiError)?.message || '值班配置删除失败'); }
  };

  const cancelRosterEdit = () => { setEditingRosterId(undefined); rosterForm.resetFields(); };

  const openDetail = async (alert: OncallAlert) => {
    setSelected(alert);
    setDetailLoading(true);
    try {
      setSelected(await getOncallAlert(alert.id));
    } catch (error: unknown) {
      message.error((error as ApiError)?.response?.data?.message || 'Oncall 告警详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const acknowledge = async (values: { comment?: string }) => {
    if (!selected) return;
    setAcknowledging(true);
    try {
      const result = await acknowledgeOncallAlert(selected.id, values.comment);
      message.success(result.acknowledged ? '告警已确认，后续重复 firing 不会重置确认状态。' : '该告警已确认或已恢复，已保留本次操作记录。');
      ackForm.resetFields();
      await openDetail(selected);
      await load();
    } catch (error: unknown) {
      message.error((error as ApiError)?.response?.data?.message || '确认告警失败');
    } finally {
      setAcknowledging(false);
    }
  };

  const columns = useMemo<ColumnsType<OncallAlert>>(() => [
    { title: '状态', dataIndex: 'status', width: 100, render: (value: OncallAlertStatus) => <StatusBadge status={value} /> },
    { title: '告警', dataIndex: 'alert_name', render: (value: string, row) => <Button type="link" style={{ padding: 0 }} onClick={() => void openDetail(row)}>{value}</Button> },
    { title: '环境', dataIndex: 'environment_id', width: 120 },
    { title: 'Namespace', dataIndex: 'namespace', width: 160, render: (value) => value || '-' },
    { title: 'Severity / 风险', width: 150, render: (_, row) => <Space size={4}>{row.severity && <Tag>{row.severity}</Tag>}{row.risk_level && <Tag color="volcano">{row.risk_level}</Tag>}</Space> },
    { title: '最近触发', dataIndex: 'last_fired_at', width: 180, render: (value) => value || '-' },
    { title: '恢复时间', dataIndex: 'resolved_at', width: 180, render: (value) => value || '-' },
  ], []);

  const summaryItems = useMemo(() => {
    const counts = { FIRING: 0, ACKED: 0, RESOLVED: 0 };
    items.forEach((item) => { counts[item.status] += 1; });
    const escalationInProgress = items.filter((item) => item.escalations?.some((escalation) => !['SENT', 'FAILED', 'UNSUPPORTED'].includes(escalation.status))).length;
    return [
      { key: 'firing', label: '告警中', value: counts.FIRING, valueStyle: { color: '#cf1322' } },
      { key: 'acked', label: '已确认', value: counts.ACKED, valueStyle: { color: '#d48806' } },
      { key: 'escalating', label: '升级中', value: escalationInProgress, hint: '仅统计已加载的告警记录', valueStyle: { color: '#1677ff' } },
      { key: 'resolved', label: '已恢复', value: counts.RESOLVED, valueStyle: { color: '#389e0d' } },
    ];
  }, [items]);

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <PageHeader
      title="Oncall 告警"
      description="接收 Alertmanager 专用 Webhook 的告警生命周期；确认、升级和通知记录均以现有后端状态为准。"
      environmentName={currentEnvironment?.name}
    />
    <Alert
      type="info"
      showIcon
      message="Oncall 告警"
      description="仅接收 Alertmanager 通过专用 Webhook 投递的告警，负责记录、通知、ACK、审计和生命周期展示。firing/resolved 以 Alertmanager 为准；resolved 由 Alertmanager 扇出，Dashboard 仅同步状态，不重复发送恢复消息。电话加急当前停用。"
    />
    <Card title="值班升级配置" size="small" extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void loadRoster()} loading={rosterLoading}>刷新</Button>}>
      <Form form={rosterForm} layout="inline" onFinish={saveRoster} style={{ marginBottom: 12 }}>
        <Select value={rosterEnvironmentId} onChange={setRosterEnvironmentId} placeholder="配置环境" style={{ width: 220 }} options={environments.map((env) => ({ value: env.id, label: `${env.name} (${env.id})` }))} />
        <Form.Item name="level" rules={[{ required: true, message: '请选择级别' }]}><Select placeholder="升级级别" style={{ width: 130 }} options={[{ value: 'L1', label: 'L1' }, { value: 'L2', label: 'L2' }, { value: 'OWNER', label: '负责人' }]} /></Form.Item>
        <Form.Item name="email" rules={[{ required: true, type: 'email', message: '请输入邮箱' }]}><Input placeholder="值班邮箱" style={{ width: 260 }} /></Form.Item>
        <Form.Item name="displayName"><Input placeholder="显示名称（可选）" style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={rosterSaving}>{editingRosterId ? '保存修改' : '添加配置'}</Button>
        {editingRosterId && <Button onClick={cancelRosterEdit}>取消编辑</Button>}
      </Form>
      <Table size="small" rowKey="id" loading={rosterLoading} pagination={false} dataSource={roster} columns={[
        { title: '环境', dataIndex: 'environment_id', width: 160 }, { title: '级别', dataIndex: 'level', width: 100 }, { title: '邮箱', dataIndex: 'email' }, { title: '名称', dataIndex: 'display_name', render: (value: string | null) => value || '-' },
        { title: '状态', dataIndex: 'enabled', width: 90, render: (value: number) => <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag> },
        { title: '操作', width: 150, render: (_: unknown, row: OncallRosterBinding) => <Space size={0}><Button type="link" onClick={() => editRoster(row)}>编辑</Button><Popconfirm title="确认删除这条值班配置？" onConfirm={() => void removeRoster(row.id)}><Button danger type="link">删除</Button></Popconfirm></Space> },
      ]} />
    </Card>
    <FilterBar actions={<Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>搜索</Button>}>
      <Select allowClear placeholder="状态" value={status} onChange={setStatus} style={{ width: 140 }} options={['FIRING', 'ACKED', 'RESOLVED'].map((value) => ({ value, label: value }))} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="环境" value={environmentId} onChange={setEnvironmentId} style={{ width: 220 }} options={environments.map((env) => ({ value: env.id, label: `${env.name} (${env.id})` }))} />
      <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void load()} placeholder="告警名称、Namespace 或指纹" style={{ width: 260 }} />
      <Text type="secondary">共 {total} 条</Text>
    </FilterBar>
    <MetricGrid items={summaryItems} loading={loading} />
    <OpsTable rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={false} scroll={{ x: 1000 }} error={loadError} onRetry={() => void load()} />
    <DetailDrawer
      title={selected ? `Oncall 告警 #${selected.id}` : 'Oncall 告警'}
      open={!!selected}
      onClose={() => setSelected(null)}
      width={760}
      loading={detailLoading}
      summary={selected ? <><StatusBadge status={selected.status} /><Tag>{selected.environment_id}</Tag></> : null}
    >
      {selected && <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="状态"><StatusBadge status={selected.status} /></Descriptions.Item>
          <Descriptions.Item label="环境">{selected.environment_id}</Descriptions.Item>
          <Descriptions.Item label="告警名称">{selected.alert_name}</Descriptions.Item>
          <Descriptions.Item label="Namespace">{selected.namespace || '-'}</Descriptions.Item>
          <Descriptions.Item label="Fingerprint" span={2}><Text code copyable>{selected.fingerprint}</Text></Descriptions.Item>
        </Descriptions>
        {selected.status !== 'RESOLVED' && <Form form={ackForm} layout="vertical" onFinish={acknowledge}>
          <Form.Item name="comment" label="确认备注（可选）"><Input.TextArea maxLength={1000} rows={2} placeholder="例如：已开始排查，关联工单 #123" /></Form.Item>
          <Button type="primary" icon={<CheckCircleOutlined />} htmlType="submit" loading={acknowledging}>确认告警</Button>
        </Form>}
        <Descriptions title="标签" bordered column={1} size="small"><Descriptions.Item label="labels"><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{asJsonText(selected.labels_json)}</pre></Descriptions.Item><Descriptions.Item label="annotations"><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{asJsonText(selected.annotations_json)}</pre></Descriptions.Item></Descriptions>
        <div><Text strong>事件时间线</Text><Timeline style={{ marginTop: 12 }} items={(selected.events || []).map((event) => ({ children: `${event.occurred_at}  ${event.event_type}${event.source_status ? ` (${event.source_status})` : ''}` }))} /></div>
        <div><Text strong>确认记录</Text><Timeline style={{ marginTop: 12 }} items={(selected.acknowledgements || []).map((ack) => ({ children: `${ack.acknowledged_at}  ${ack.actor_username || '-'}: ${ack.result}${ack.comment ? ` — ${ack.comment}` : ''}` }))} /></div>
        <div><Text strong>Lark 通知</Text><Timeline style={{ marginTop: 12 }} items={(selected.notifications || []).map((notification) => ({ color: notification.status === 'SENT' ? 'green' : notification.status === 'FAILED' ? 'red' : 'gray', children: `${notification.created_at}  ${notification.channel}: ${notification.status}${notification.error_message ? ` — ${notification.error_message}` : ''}` }))} /></div>
        <div><Text strong>升级记录</Text><Timeline style={{ marginTop: 12 }} items={(selected.escalations || []).map((escalation) => ({ color: escalation.status === 'SENT' ? 'green' : escalation.status === 'UNSUPPORTED' ? 'gold' : escalation.status === 'FAILED' ? 'red' : 'gray', children: `${escalation.scheduled_at}  ${escalation.level}: ${escalation.status}${escalation.error_message ? ` — ${escalation.error_message}` : ''}` }))} /></div>
      </Space>}
    </DetailDrawer>
  </Space>;
};

export default OncallPage;
