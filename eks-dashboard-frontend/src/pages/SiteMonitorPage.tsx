import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Button, Table, Tag, Space, Modal, Form, Input, InputNumber, Switch, message, Popconfirm, Descriptions, Select } from 'antd';
import { getSiteMonitors, createSiteMonitor, deleteSiteMonitor, checkSiteMonitor, getAlertConfig, saveAlertConfig, testAlert, updateSiteMonitor, getSiteMonitorById } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import { getTenantsForEnvironment } from '../services/api';

type SiteRow = {
  id: number;
  tenant_id?: number | null;
  name: string;
  host: string;
  port: number;
  is_https: 0 | 1;
  environment_label?: string | null;
  notes?: string | null;
  acceptable_status_codes?: string | null;
  last_checked_at?: string | null;
  dns_ok?: 0 | 1 | null;
  resolved_ips?: string | null;
  tcp_latency_ms?: number | null;
  http_status?: number | null;
  ssl_valid?: 0 | 1 | null;
  ssl_issuer?: string | null;
  ssl_subject?: string | null;
  ssl_not_before?: string | null;
  ssl_not_after?: string | null;
  last_error?: string | null;
  treated_ok?: boolean;
};

const SiteMonitorPage: React.FC = () => {
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [data, setData] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<SiteRow | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [tenantFilter, setTenantFilter] = useState<number | undefined>(undefined);
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [hostFilter, setHostFilter] = useState<string>('');
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [alertWebhook, setAlertWebhook] = useState<string | undefined>(undefined);
  const [alertFailureThreshold, setAlertFailureThreshold] = useState<number>(3);
  const [alertCooldownMinutes, setAlertCooldownMinutes] = useState<number>(60);
  const [alertProbeTimeoutMs, setAlertProbeTimeoutMs] = useState<number | undefined>(undefined);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [alertAcceptableStatusCodes, setAlertAcceptableStatusCodes] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    if (detailRecord) {
      editForm.setFieldsValue({
        tenant_id: detailRecord.tenant_id ?? undefined,
        name: detailRecord.name,
        host: detailRecord.host,
        port: detailRecord.port,
        notes: detailRecord.notes,
        acceptable_status_codes: detailRecord.acceptable_status_codes || undefined,
      });
    } else {
      editForm.resetFields();
    }
  }, [detailRecord]);

  const toBeijingString = (v?: string | null) => {
    if (!v) return '-';
    // Try to parse as ISO; if it's a plain 'YYYY-MM-DD HH:mm:ss', treat it as UTC by appending Z
    let d: Date;
    if (typeof v === 'string') {
      if (v.includes('T')) {
        d = new Date(v);
      } else {
        d = new Date(v.replace(' ', 'T') + 'Z');
      }
    } else {
      d = new Date(v);
    }
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  };

  const load = async () => {
    if (!currentEnvironment) {
      setData([]);
      return;
    }
    setData([]);
    setLoading(true);
    try {
      const rows = await getSiteMonitors(tenantFilter);
      setData(rows);
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    const q = (hostFilter || '').trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => (r.host || '').toLowerCase().includes(q));
  }, [data, hostFilter]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEnvironment?.id, tenantFilter]);

  useEffect(() => {
    const fetchTenants = async () => {
      if (!currentEnvironment) {
        setTenants([]);
        return;
      }
      try {
        const list = await getTenantsForEnvironment();
        setTenants(list);
      } catch (e: any) {
        // ignore
      }
    };
    fetchTenants();
  }, [currentEnvironment?.id]);

  const onCreate = async () => {
    try {
      const values = await form.validateFields();
      await createSiteMonitor({
        name: values.name,
        host: values.host,
        port: values.port,
        isHttps: values.isHttps,
        notes: values.notes,
        tenantId: values.tenantId,
        acceptableStatusCodes: values.acceptableStatusCodes,
      });
      message.success('已添加');
      setModalOpen(false);
      form.resetFields();
      await load();
    } catch (e: any) {
      if (e?.errorFields) return; // form error
      message.error(e?.message || '添加失败');
    }
  };

  const onDelete = async (id: number) => {
    try {
      await deleteSiteMonitor(id);
      message.success('已删除');
      await load();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const onCheck = async (id: number) => {
    try {
      setCheckingId(id);
      const updated = await checkSiteMonitor(id);
      setData((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    } catch (e: any) {
      message.error(e?.message || '检查失败');
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setModalOpen(true)}>添加站点</Button>
        <Button onClick={load} loading={loading}>刷新</Button>
        <Input
          allowClear
          placeholder="按 Host筛选"
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="按租户筛选"
          value={tenantFilter}
          onChange={(v) => setTenantFilter(v)}
          style={{ width: 220 }}
          options={tenants.map(t => ({ label: t.name, value: t.id }))}
        />
        <Button onClick={async () => {
          try {
            const cfg = await getAlertConfig();
            setAlertWebhook(cfg.lark_webhook_url || cfg.effective_lark_webhook_url || '');
            setAlertFailureThreshold(cfg.failure_threshold ?? 3);
            setAlertCooldownMinutes(cfg.cooldown_minutes ?? 60);
            setAlertProbeTimeoutMs(cfg.probe_timeout_ms ?? undefined);
            setAlertAcceptableStatusCodes(cfg.acceptable_status_codes ?? undefined);
            setAlertModalOpen(true);
          } catch (e: any) {
            message.error(e?.message || '加载告警配置失败');
          }
        }}>告警设置</Button>
      </Space>
      <Table<SiteRow>
        rowKey="id"
        dataSource={filteredData}
        loading={loading}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total}` }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: 'Host', dataIndex: 'host' },
          { title: '端口', dataIndex: 'port', width: 80 },
          { title: '协议', dataIndex: 'is_https', width: 80, render: (v) => (v ? 'HTTPS' : 'HTTP') },
          { title: '租户', dataIndex: 'tenant_id', render: (tid?: number) => tenants.find(t => t.id === tid)?.name || '-' },
          { title: '是否可用', dataIndex: 'treated_ok', width: 110, render: (_, r) => (r.treated_ok ? <Tag color='green'>可用</Tag> : (typeof r.http_status === 'number' ? <Tag color='red'>不可用</Tag> : '-')) },
          {
            title: 'SSL',
            render: (_, r) => r.is_https ? (
              <Space size={4} direction="vertical">
                <div>{r.ssl_valid === 1 ? <Tag color="green">有效</Tag> : r.ssl_valid === 0 ? <Tag color="red">无效</Tag> : '-'}</div>
              </Space>
            ) : '-'
          },
          { title: '备注', dataIndex: 'notes' },
          {
            title: '操作',
            fixed: 'right',
            width: 240,
            render: (_, r) => (
              <Space>
                <Button size='small' onClick={async () => { 
                  try {
                    setDetailOpen(true);
                    setDetailRecord(null);
                    const fresh = await getSiteMonitorById(r.id);
                    setDetailRecord(fresh);
                    // sync form values
                    editForm.setFieldsValue({
                      tenant_id: fresh.tenant_id ?? undefined,
                      name: fresh.name,
                      host: fresh.host,
                      port: fresh.port,
                      notes: fresh.notes,
                    });
                  } catch (e: any) {
                    message.error(e?.message || '加载详情失败');
                  }
                }}>详情</Button>
                <Button size="small" loading={checkingId === r.id} onClick={() => onCheck(r.id)}>检查</Button>
                <Popconfirm title="确认删除?" onConfirm={() => onDelete(r.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="站点详情"
        open={detailOpen}
        onCancel={() => { editForm.resetFields(); setDetailOpen(false); setDetailRecord(null); }}
        onOk={async () => {
          try {
            const values = await editForm.validateFields();
            const payload: any = {};
            if ('tenant_id' in values) payload.tenantId = values.tenant_id;
            if ('name' in values) payload.name = values.name;
            if ('host' in values) payload.host = values.host;
            if ('port' in values) payload.port = values.port;
            if ('notes' in values) payload.notes = values.notes;
            if ('acceptable_status_codes' in values) payload.acceptableStatusCodes = values.acceptable_status_codes;
            if (detailRecord) {
              const updated = await updateSiteMonitor(detailRecord.id, payload);
              setData((prev) => prev.map((r) => (r.id === detailRecord.id ? { ...r, ...updated } : r)));
              setDetailRecord(updated);
              message.success('已保存');
              setDetailOpen(false);
              editForm.resetFields();
              setDetailRecord(null);
            }
          } catch (e: any) {
            if (e?.errorFields) return;
            message.error(e?.message || '保存失败');
          }
        }}
        okText="保存"
        destroyOnClose
        width={720}
      >
        {detailRecord ? (
          <>
            <Form form={editForm} layout="vertical" initialValues={{
              tenant_id: detailRecord.tenant_id ?? undefined,
              name: detailRecord.name,
              host: detailRecord.host,
              port: detailRecord.port,
              notes: detailRecord.notes,
              acceptable_status_codes: detailRecord.acceptable_status_codes || undefined,
            }}>
              <Space style={{ marginBottom: 12 }}>
                <Tag color={detailRecord.treated_ok ? 'green' : 'red'}>
                  {detailRecord.treated_ok ? '可用' : '不可用'}
                </Tag>
                <span>最后检查：{toBeijingString(detailRecord.last_checked_at)}</span>
              </Space>
              <Form.Item name="tenant_id" label="租户">
                <Select allowClear placeholder="选择租户" options={tenants.map(t => ({ label: t.name, value: t.id }))} />
              </Form.Item>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="host" label="域名/主机" rules={[{ required: true, message: '请输入域名或主机' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="port" label="端口" rules={[{ required: true, type: 'number', min: 1 }]}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="notes" label="备注">
                <Input />
              </Form.Item>
              <Form.Item name="acceptable_status_codes" label="成功代码">
                <Input placeholder="留空则使用环境/默认，示例：200-399 或 200,302,404" />
              </Form.Item>
            </Form>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="DNS">{detailRecord.dns_ok === 1 ? 'OK' : detailRecord.dns_ok === 0 ? 'FAIL' : '-'}</Descriptions.Item>
              <Descriptions.Item label="解析IP">{detailRecord.resolved_ips || '-'}</Descriptions.Item>
              <Descriptions.Item label="TCP延迟(ms)">{detailRecord.tcp_latency_ms ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="HTTP状态码">{detailRecord.http_status ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="SSL有效">{detailRecord.is_https ? (detailRecord.ssl_valid === 1 ? '有效' : detailRecord.ssl_valid === 0 ? '无效' : '-') : '-'}</Descriptions.Item>
              <Descriptions.Item label="证书颁发者">{detailRecord.ssl_issuer || '-'}</Descriptions.Item>
              <Descriptions.Item label="证书主题">{detailRecord.ssl_subject || '-'}</Descriptions.Item>
              <Descriptions.Item label="证书起始">{toBeijingString(detailRecord.ssl_not_before)}</Descriptions.Item>
              <Descriptions.Item label="证书到期">{toBeijingString(detailRecord.ssl_not_after)}</Descriptions.Item>
              <Descriptions.Item label="错误信息" span={2}>{detailRecord.last_error || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        ) : null}
      </Modal>

      <Modal
        title="告警设置（当前环境）"
        open={alertModalOpen}
        onCancel={() => setAlertModalOpen(false)}
        onOk={async () => {
          try {
            await saveAlertConfig({ lark_webhook_url: alertWebhook || null, failure_threshold: alertFailureThreshold, cooldown_minutes: alertCooldownMinutes, probe_timeout_ms: alertProbeTimeoutMs, acceptable_status_codes: alertAcceptableStatusCodes ?? null });
            message.success('已保存');
            setAlertModalOpen(false);
          } catch (e: any) {
            message.error(e?.message || '保存失败');
          }
        }}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input placeholder="Lark Webhook URL" value={alertWebhook} onChange={(e) => setAlertWebhook(e.target.value)} />
          <Space>
            <InputNumber addonBefore="失败阈值" min={1} value={alertFailureThreshold} onChange={(v) => setAlertFailureThreshold((v as number) || 1)} placeholder="3" />
            <InputNumber addonBefore="静默(分钟)" min={1} value={alertCooldownMinutes} onChange={(v) => setAlertCooldownMinutes((v as number) || 1)} placeholder="60" />
            <InputNumber addonBefore="超时(ms)" min={1000} step={500} value={alertProbeTimeoutMs} onChange={(v) => setAlertProbeTimeoutMs(v as number)} placeholder="5000" />
          </Space>
          <Input placeholder="成功代码（如 200-399 或 200,302,404）" value={alertAcceptableStatusCodes} onChange={(e) => setAlertAcceptableStatusCodes(e.target.value)} />
          <Button onClick={async () => {
            try {
              await testAlert();
              message.success('测试告警已发送');
            } catch (e: any) {
              message.error(e?.message || '发送失败');
            }
          }}>发送测试告警</Button>
          <div style={{ color: '#999' }}>优先使用数据库配置；为空时回退 environments.json 中的 alerts。失败阈值=连续失败N次触发，静默=告警后N分钟内抑制重复告警。成功代码用于判断“不告警”的可接受状态，例如 200-399 或 200,302,404。</div>
        </Space>
      </Modal>

      <Modal
        title="添加站点"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onCreate}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical" form={form} initialValues={{ port: 443, isHttps: true }}>
          <Form.Item name="tenantId" label="租户">
            <Select allowClear placeholder="选择租户" options={tenants.map(t => ({ label: t.name, value: t.id }))} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：官网" />
          </Form.Item>
          <Form.Item name="host" label="域名/主机" rules={[{ required: true, message: '请输入域名或主机' }]}>
            <Input placeholder="支持多个域名，用英文逗号分隔，例如: a.example.com,b.example.com" />
          </Form.Item>
          <Form.Item name="port" label="端口" rules={[{ required: true, type: 'number', min: 1 }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isHttps" label="HTTPS" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input />
          </Form.Item>
          <Form.Item name="acceptableStatusCodes" label="成功代码">
            <Input placeholder="留空则使用环境/默认，示例：200-399 或 200,302,404" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SiteMonitorPage;
