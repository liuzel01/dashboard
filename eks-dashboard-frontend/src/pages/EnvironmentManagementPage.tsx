import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Space, Spin, Table, message } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  createEnvironmentConfig,
  getEnvironmentConfig,
  getEnvironmentConfigs,
  updateEnvironmentConfig,
} from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';

type EnvConfig = {
  id: string;
  name: string;
  aws_region?: string;
  aws_profile?: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  kubeContext?: string;
  database?: any;
  redis?: any;
  jumpServer?: any;
  tenants?: any;
  platforms?: any;
  alerts?: any;
};

const jsonFields = ['database', 'redis', 'jumpServer', 'tenants', 'platforms', 'alerts'] as const;

const toJsonString = (value: any) => {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

const normalizeOptionalString = (value?: string) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
};

const EnvironmentManagementPage: React.FC = () => {
  const { refreshEnvironments } = useContext(EnvironmentContext);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<EnvConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEnvironmentConfigs();
      setList(data || []);
    } catch (e: any) {
      setError(e?.message || '加载环境配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    setLoading(true);
    try {
      const data: EnvConfig = await getEnvironmentConfig(id);
      form.setFieldsValue({
        ...data,
        database: toJsonString(data.database),
        redis: toJsonString(data.redis),
        jumpServer: toJsonString(data.jumpServer),
        tenants: toJsonString(data.tenants),
        platforms: toJsonString(data.platforms),
        alerts: toJsonString(data.alerts),
      });
      setModalOpen(true);
    } catch (e: any) {
      message.error(e?.message || '加载环境详情失败');
    } finally {
      setLoading(false);
    }
  };

  const parseJsonInput = (value: string, fieldLabel: string) => {
    if (!value || value.trim() === '') return undefined;
    try {
      return JSON.parse(value);
    } catch (e) {
      throw new Error(`${fieldLabel} 不是有效的 JSON`);
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload: any = {
      id: values.id,
      name: values.name,
      aws_region: values.aws_region,
      aws_profile: normalizeOptionalString(values.aws_profile),
      aws_access_key_id: normalizeOptionalString(values.aws_access_key_id),
      aws_secret_access_key: normalizeOptionalString(values.aws_secret_access_key),
      kubeContext: normalizeOptionalString(values.kubeContext),
    };

    try {
      jsonFields.forEach((field) => {
        const raw = values[field];
        const parsed = parseJsonInput(raw, field);
        if (parsed !== undefined) {
          payload[field] = parsed;
        }
      });
    } catch (e: any) {
      message.error(e.message || 'JSON 解析失败');
      return;
    }

    try {
      setLoading(true);
      if (editingId) {
        await updateEnvironmentConfig(editingId, payload);
        message.success('环境配置已更新');
      } else {
        await createEnvironmentConfig(payload);
        message.success('环境配置已创建');
      }
      setModalOpen(false);
      await fetchList();
      await refreshEnvironments();
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = useMemo(
    () => [
      { title: '环境ID', dataIndex: 'id', width: 140 },
      { title: '名称', dataIndex: 'name', width: 220 },
      { title: 'Region', dataIndex: 'aws_region', width: 140 },
      { title: 'AWS Profile', dataIndex: 'aws_profile', width: 160 },
      { title: 'AWS Access Key ID', dataIndex: 'aws_access_key_id', width: 220 },
      { title: 'Kube Context', dataIndex: 'kubeContext', width: 200 },
      {
        title: '操作',
        key: 'action',
        width: 120,
        render: (_: any, record: EnvConfig) => (
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record.id)}>
            编辑
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增环境
        </Button>
        <Button icon={<ReloadOutlined />} onClick={fetchList}>
          刷新
        </Button>
      </Space>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Spin spinning={loading}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={list}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Spin>

      <Modal
        title={editingId ? '编辑环境' : '新增环境'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        destroyOnClose
        width={900}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="凭证填写建议"
          description="AWS 凭证支持两种方式：推荐填写 AK/SK（AWS Access Key ID + AWS Secret Access Key）；也可以填写 aws_profile（依赖服务器本地 AWS 配置）。两者填一项即可，Kube Context 仍需按实际集群配置。"
        />
        <Form form={form} layout="vertical">
          <Form.Item
            label="环境ID"
            name="id"
            rules={[{ required: true, message: '请输入环境ID' }]}
          >
            <Input disabled={!!editingId} placeholder="例如: prod / staging" />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="AWS Region"
            name="aws_region"
            rules={[{ required: true, message: '请输入 AWS Region' }]}
          >
            <Input placeholder="例如: ap-northeast-1" />
          </Form.Item>
          <Form.Item label="AWS Profile" name="aws_profile">
            <Input placeholder="使用 profile 时填写" />
          </Form.Item>
          <Form.Item label="AWS Access Key ID" name="aws_access_key_id">
            <Input placeholder="使用 AK/SK 时填写" />
          </Form.Item>
          <Form.Item label="AWS Secret Access Key" name="aws_secret_access_key">
            <Input.Password placeholder="使用 AK/SK 时填写" />
          </Form.Item>
          <Form.Item label="Kube Context" name="kubeContext">
            <Input placeholder="kubeconfig context 名称" />
          </Form.Item>
          <Form.Item label="Database (JSON)" name="database">
            <Input.TextArea rows={4} placeholder='{"host":"", "port":3306, "user":"", "password":"", "database":""}' />
          </Form.Item>
          <Form.Item label="Redis (JSON)" name="redis">
            <Input.TextArea rows={3} placeholder='{"host":"", "port":6379, "password":"", "ssl":true}' />
          </Form.Item>
          <Form.Item label="Jump Server (JSON)" name="jumpServer">
            <Input.TextArea rows={3} placeholder='{"host":"", "port":22, "username":"ubuntu", "privateKeyPath":""}' />
          </Form.Item>
          <Form.Item label="Tenants (JSON)" name="tenants">
            <Input.TextArea rows={3} placeholder='[{"id":1,"name":"tenant"}]' />
          </Form.Item>
          <Form.Item label="Platforms (JSON)" name="platforms">
            <Input.TextArea rows={3} placeholder='[{"name":"","loadBalancerArn":""}]' />
          </Form.Item>
          <Form.Item label="Alerts (JSON)" name="alerts">
            <Input.TextArea rows={3} placeholder='{"lark_webhook_url":"", "acceptable_status_codes":"200-399"}' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default EnvironmentManagementPage;
