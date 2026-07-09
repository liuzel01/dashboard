import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  createSslCertificateDecryptedDownload,
  exportSslCertificateEncryptedPackage,
  getSslCertificateDetail,
  getSslCertificates,
  getSslCertificateDownloadUrl,
} from '../services/api';

const { Text } = Typography;

type SslCertificateItem = {
  certificateId: number;
  arn: string;
  certName: string;
  domain: string;
  sans: string[];
  status: string;
  certType: string;
  canExport: boolean;
  endDate: string | null;
  lastExportedAt: string | null;
  lastExportedBy: string | null;
};

const formatTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
};

const SslCertificateExportPage: React.FC = () => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SslCertificateItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<SslCertificateItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<SslCertificateItem | null>(null);
  const [actionMode, setActionMode] = useState<'export' | 'decrypt' | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async (nextKeyword = keyword) => {
    setLoading(true);
    try {
      const resp = await getSslCertificates({ keyword: nextKeyword, page: 1, pageSize: 100 });
      setItems(Array.isArray(resp?.items) ? resp.items : []);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '证书列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpenDetail = async (row: SslCertificateItem) => {
    setLoading(true);
    try {
      const resp = await getSslCertificateDetail(row.certificateId);
      setDetail(resp);
      setDetailOpen(true);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  const onOpenAction = (row: SslCertificateItem, mode: 'export' | 'decrypt') => {
    setActionTarget(row);
    setActionMode(mode);
    form.resetFields();
    setActionOpen(true);
  };

  const onSubmitAction = async () => {
    if (!actionTarget || !actionMode) return;
    const values = await form.validateFields();
    setLoading(true);
    try {
      if (actionMode === 'export') {
        const resp = await exportSslCertificateEncryptedPackage(actionTarget.certificateId, values);
        Modal.info({
          title: '已返回加密导出结果',
          width: 800,
          content: (
            <div>
              <Alert type="success" showIcon message="已通过后端调用导出加密包接口" style={{ marginBottom: 12 }} />
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto' }}>
                {JSON.stringify(resp?.payload ?? resp, null, 2)}
              </pre>
            </div>
          ),
        });
      } else {
        const resp = await createSslCertificateDecryptedDownload(actionTarget.certificateId, values);
        const url = getSslCertificateDownloadUrl(resp.downloadToken);
        window.open(url, '_blank', 'noopener,noreferrer');
        message.success('已生成一次性短时下载链接，浏览器将开始下载');
      }
      setActionOpen(false);
      await load(keyword);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<SslCertificateItem> = [
    { title: '域名', dataIndex: 'domain', width: 220 },
    {
      title: 'SAN',
      dataIndex: 'sans',
      render: (value: string[]) => value?.length ? <Text>{value.join(', ')}</Text> : '-',
    },
    { title: '状态', dataIndex: 'status', width: 120, render: (v) => <Tag color={String(v).toLowerCase().includes('success') || String(v).toLowerCase().includes('issued') ? 'green' : 'blue'}>{v || '-'}</Tag> },
    { title: '证书类型/可导出', width: 170, render: (_, row) => <Space direction="vertical" size={0}><span>{row.certType || '-'}</span><Tag color={row.canExport ? 'green' : 'default'}>{row.canExport ? '可导出' : '受限'}</Tag></Space> },
    { title: '到期时间', dataIndex: 'endDate', width: 180, render: (v) => formatTime(v) },
    { title: 'ARN', dataIndex: 'arn', width: 220, ellipsis: true },
    { title: '最近导出时间', dataIndex: 'lastExportedAt', width: 180, render: (v) => formatTime(v) },
    { title: '最近导出人', dataIndex: 'lastExportedBy', width: 140, render: (v) => v || '-' },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => onOpenDetail(row)}>查看详情</Button>
          <Button size="small" type="primary" onClick={() => onOpenAction(row, 'export')}>导出加密包</Button>
          <Button size="small" danger onClick={() => onOpenAction(row, 'decrypt')}>解密下载</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="warning"
        showIcon
        message="该页面涉及证书私钥高敏操作"
        description="默认优先推荐“导出加密包”。解密下载必须二次输入 Google 验证码 + passphrase；明文私钥不会展示在页面 textarea，也不会拼接到 URL。"
      />

      <Card title="SSL证书申请与导出">
        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder="搜索域名 / SAN / ARN / 证书名"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 320 }}
            allowClear
          />
          <Button type="primary" onClick={() => load(keyword)} loading={loading}>查询</Button>
          <Button onClick={() => { setKeyword(''); load(''); }} disabled={loading}>重置</Button>
        </Space>
        <Table
          rowKey="certificateId"
          loading={loading}
          dataSource={items}
          columns={columns}
          pagination={false}
          scroll={{ x: 1600 }}
        />
      </Card>

      <Modal title="证书详情" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        {detail && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="域名">{detail.domain}</Descriptions.Item>
            <Descriptions.Item label="SAN">{detail.sans?.join(', ') || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{detail.status || '-'}</Descriptions.Item>
            <Descriptions.Item label="证书类型">{detail.certType || '-'}</Descriptions.Item>
            <Descriptions.Item label="是否可导出">{detail.canExport ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="到期时间">{formatTime(detail.endDate)}</Descriptions.Item>
            <Descriptions.Item label="ARN">{detail.arn}</Descriptions.Item>
            <Descriptions.Item label="最近导出时间">{formatTime(detail.lastExportedAt)}</Descriptions.Item>
            <Descriptions.Item label="最近导出人">{detail.lastExportedBy || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={actionMode === 'export' ? '导出加密包' : '解密下载'}
        open={actionOpen}
        onCancel={() => setActionOpen(false)}
        onOk={onSubmitAction}
        okText={actionMode === 'export' ? '确认导出' : '确认生成下载链接'}
        confirmLoading={loading}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {actionMode === 'decrypt' && (
            <Alert
              type="error"
              showIcon
              message="高风险操作"
              description="该操作会在服务端内存中生成明文私钥文件，并以一次性短时链接下载。请确认仅在必要场景使用。"
            />
          )}
          {actionMode === 'export' && (
            <Alert
              type="info"
              showIcon
              message="推荐优先使用导出加密包"
              description="会调用证书导出接口并保留加密保护，不默认鼓励明文私钥使用。"
            />
          )}
          <Form form={form} layout="vertical">
            <Form.Item label="Google 验证码" name="otpCode" rules={[{ required: true, message: '请输入 Google 验证码' }]}>
              <Input placeholder="6 位验证码" maxLength={12} autoComplete="one-time-code" />
            </Form.Item>
            <Form.Item label="Passphrase" name="passphrase" rules={[{ required: true, min: 8, message: '请输入至少 8 位 passphrase' }]}>
              <Input.Password placeholder="当次输入，不持久化" autoComplete="new-password" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </Space>
  );
};

export default SslCertificateExportPage;
