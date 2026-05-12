import React, { useEffect, useState } from 'react';
import { Button, DatePicker, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { deleteOldAuditLogs, getAuditLogs } from '../services/api';

const { RangePicker } = DatePicker;
const { Text } = Typography;

type AuditLog = {
  id: number;
  created_at: string;
  actor_username?: string;
  actor_display_name?: string;
  environment_id?: string;
  method?: string;
  path?: string;
  action?: string;
  action_name?: string;
  target_type?: string;
  target_id?: string;
  request_summary?: any;
  response_summary?: any;
  status?: string;
  status_code?: number;
  error_message?: string;
  duration_ms?: number;
  ip?: string;
  user_agent?: string;
  trace_id?: string;
};

const parseJsonMaybe = (value: any) => {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};


const formatBeijingTime = (value?: string) => {
  if (!value) return '-';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(`${normalized.replace(/Z$/, '')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())} ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}:${pad(beijing.getUTCSeconds())}`;
};


const renderNoWrap = (value: React.ReactNode) => (
  <span style={{ whiteSpace: 'nowrap' }}>{value}</span>
);

const renderOperation = (row: AuditLog) => {
  const method = row.method || '';
  const path = row.path || '';
  const operation = [method, path].filter(Boolean).join(' ') || row.action || '-';
  return <Text code>{operation}</Text>;
};

const renderJson = (value: any) => {
  const parsed = parseJsonMaybe(value);
  if (parsed === null || parsed === undefined || parsed === '') return '-';
  return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{JSON.stringify(parsed, null, 2)}</pre>;
};

const AuditLogPage: React.FC = () => {
  const [form] = Form.useForm();
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const fetchLogs = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const range = values.range || [];
      const resp = await getAuditLogs({
        page: nextPage,
        pageSize: nextPageSize,
        startTime: range[0]?.format?.('YYYY-MM-DD HH:mm:ss'),
        endTime: range[1]?.format?.('YYYY-MM-DD HH:mm:ss'),
        username: values.username,
        method: values.method,
        status: values.status,
        environmentId: values.environmentId,
        action: values.action,
        keyword: values.keyword,
      });
      setItems(resp.items || []);
      setTotal(resp.total || 0);
      setPage(resp.page || nextPage);
      setPageSize(resp.pageSize || nextPageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCleanup = () => {
    Modal.confirm({
      title: '清理 90 天前日志？',
      content: '该操作会永久删除 90 天以前的审计日志。确认继续？',
      okText: '确认清理',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const resp = await deleteOldAuditLogs();
        message.success(`已清理 ${resp.deleted || 0} 条日志`);
        fetchLogs(1, pageSize);
      },
    });
  };

  const columns: ColumnsType<AuditLog> = [
    { title: '时间', dataIndex: 'created_at', width: 190, render: (v) => renderNoWrap(formatBeijingTime(v)) },
    { title: '用户', dataIndex: 'actor_username', width: 140, render: (_, row) => row.actor_display_name || row.actor_username || '-' },
    { title: '环境', dataIndex: 'environment_id', width: 120, render: (v) => v || '-' },
    { title: '方法', dataIndex: 'method', width: 80, render: (v) => v ? <Tag>{v}</Tag> : '-' },
    { title: '操作', dataIndex: 'path', width: 240, render: (_, row) => renderOperation(row) },
    { title: '操作名称', dataIndex: 'action_name', width: 160, render: (_, row) => row.action_name || row.action || '-' },
    { title: '资源', dataIndex: 'target_id', ellipsis: true, render: (_, row) => row.target_id || row.target_type || '-' },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Tag color={v === 'failed' ? 'red' : 'green'}>{v || '-'}</Tag> },
    { title: '耗时', dataIndex: 'duration_ms', width: 90, render: (v) => v == null ? '-' : `${v}ms` },
    { title: 'IP', dataIndex: 'ip', width: 140, render: (v) => v || '-' },
    { title: '详情', width: 80, render: (_, row) => <Button size="small" onClick={() => setSelected(row)}>查看</Button> },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>审计日志</Typography.Title>
          <Text type="secondary">记录用户触发的后端 API 操作历史，不记录页面访问/菜单点击。</Text>
        </div>
        <Button danger onClick={onCleanup}>清理 90 天前日志</Button>
      </Space>

      <Form form={form} layout="inline" onFinish={() => fetchLogs(1, pageSize)}>
        <Form.Item name="range" label="时间">
          <RangePicker showTime />
        </Form.Item>
        <Form.Item name="username" label="用户">
          <Input placeholder="用户名" allowClear style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="method" label="方法">
          <Select allowClear style={{ width: 110 }} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => ({ label: v, value: v }))} />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select allowClear style={{ width: 110 }} options={[{ label: '成功', value: 'success' }, { label: '失败', value: 'failed' }]} />
        </Form.Item>
        <Form.Item name="environmentId" label="环境">
          <Input placeholder="环境 ID" allowClear style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="action" label="Action">
          <Input placeholder="action" allowClear style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="keyword" label="关键词">
          <Input placeholder="路径/资源/错误" allowClear style={{ width: 180 }} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">查询</Button>
            <Button onClick={() => { form.resetFields(); fetchLogs(1, pageSize); }}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => fetchLogs(p, ps),
        }}
      />

      <Modal title="审计详情" open={!!selected} onCancel={() => setSelected(null)} footer={null} width={900}>
        {selected && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="时间">{formatBeijingTime(selected.created_at)} <Text type="secondary">UTC+8</Text></Descriptions.Item>
            <Descriptions.Item label="用户">{selected.actor_display_name || selected.actor_username || '-'}</Descriptions.Item>
            <Descriptions.Item label="环境">{selected.environment_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="方法/路径">{selected.method} {selected.path}</Descriptions.Item>
            <Descriptions.Item label="操作">{renderOperation(selected)}，Action: {selected.action_name || selected.action || '-'}</Descriptions.Item>
            <Descriptions.Item label="资源">{selected.target_type || '-'} / {selected.target_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{selected.status} / {selected.status_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="耗时">{selected.duration_ms == null ? '-' : `${selected.duration_ms}ms`}</Descriptions.Item>
            <Descriptions.Item label="IP">{selected.ip || '-'}</Descriptions.Item>
            <Descriptions.Item label="Trace ID">{selected.trace_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="User Agent">{selected.user_agent || '-'}</Descriptions.Item>
            <Descriptions.Item label="Request Summary">{renderJson(selected.request_summary)}</Descriptions.Item>
            <Descriptions.Item label="Response Summary">{renderJson(selected.response_summary)}</Descriptions.Item>
            <Descriptions.Item label="错误信息">{selected.error_message || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Space>
  );
};

export default AuditLogPage;
