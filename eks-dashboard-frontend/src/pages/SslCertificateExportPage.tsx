import React, { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  createSslCertificateDecryptedDownload,
  getEnvironmentConfigs,
  getSslCertificateDetail,
  getSslCertificates,
} from '../services/api';

const { Text } = Typography;

type SslCertificateItem = {
  certificateArn: string;
  certificateId: string;
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
  sourceEnvironmentId?: string;
  sourceRegion?: string;
};

type EnvOption = {
  id: string;
  name: string;
  aws_region?: string;
  aws_profile?: string;
  aws_access_key_id?: string;
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
  const [actionMode, setActionMode] = useState<'decrypt' | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [form] = Form.useForm();
  const [envOptions, setEnvOptions] = useState<EnvOption[]>([]);
  const [environmentId, setEnvironmentId] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [queriedEnvironmentId, setQueriedEnvironmentId] = useState<string>('');
  const [queriedRegion, setQueriedRegion] = useState<string>('');

  const queriedEnv = useMemo(() => envOptions.find((item) => item.id === queriedEnvironmentId) || null, [envOptions, queriedEnvironmentId]);

  const loadEnvOptions = async () => {
    try {
      const data = await getEnvironmentConfigs();
      const list = Array.isArray(data) ? data : [];
      setEnvOptions(list);
      if (!environmentId && list.length > 0) {
        const first = list[0];
        setEnvironmentId(first.id);
        setRegion(first.aws_region || '');
      }
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || 'AWS 环境列表加载失败');
    }
  };

  const load = async (nextKeyword = keyword, nextEnvironmentId = environmentId, nextRegion = region) => {
    if (!nextEnvironmentId) return;
    setLoading(true);
    try {
      const resp = await getSslCertificates({
        environmentId: nextEnvironmentId,
        region: nextRegion || undefined,
        keyword: nextKeyword,
        page: 1,
        pageSize: 100,
      });
      setItems(Array.isArray(resp?.items) ? resp.items : []);
      setQueriedEnvironmentId(nextEnvironmentId);
      setQueriedRegion(nextRegion || '');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || 'AWS ACM 证书列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEnvOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpenDetail = async (row: SslCertificateItem) => {
    if (!queriedEnvironmentId) {
      message.warning('请先点击“查询”加载证书列表');
      return;
    }
    setLoading(true);
    try {
      const resp = await getSslCertificateDetail({
        environmentId: queriedEnvironmentId,
        region: queriedRegion || undefined,
        certificateArn: row.certificateArn,
      });
      setDetail(resp);
      setDetailOpen(true);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  const onOpenAction = (row: SslCertificateItem, mode: 'decrypt') => {
    if (!queriedEnvironmentId) {
      message.warning('请先点击“查询”加载证书列表');
      return;
    }
    setActionTarget(row);
    setActionMode(mode);
    form.resetFields();
    setActionOpen(true);
  };

  const onSubmitAction = async () => {
    if (!actionTarget || !actionMode || !queriedEnvironmentId) return;
    const values = await form.validateFields();
    const payload = {
      environmentId: queriedEnvironmentId,
      region: queriedRegion || undefined,
      certificateArn: actionTarget.certificateArn,
      ...values,
    };
    setLoading(true);
    try {
      const resp = await createSslCertificateDecryptedDownload(payload);
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] || 'application/x-pem-file' });
      const disposition = String(resp.headers['content-disposition'] || '');
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `${actionTarget.domain || 'certificate'}-certificate-package.zip`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('已直接下载证书文件包（zip）');
      setActionOpen(false);
      await load(keyword, queriedEnvironmentId, queriedRegion);
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
    { title: '状态', dataIndex: 'status', width: 120, render: (v) => <Tag color={String(v).toLowerCase().includes('issued') ? 'green' : 'blue'}>{v || '-'}</Tag> },
    { title: '证书类型/可导出', width: 170, render: (_, row) => <Space direction="vertical" size={0}><span>{row.certType || '-'}</span><Tag color={row.canExport ? 'green' : 'default'}>{row.canExport ? '可导出' : '受限'}</Tag></Space> },
    { title: '到期时间', dataIndex: 'endDate', width: 180, render: (v) => formatTime(v) },
    { title: 'ARN', dataIndex: 'arn', width: 320, ellipsis: true },
    { title: '最近导出时间', dataIndex: 'lastExportedAt', width: 180, render: (v) => formatTime(v) },
    { title: '最近导出人', dataIndex: 'lastExportedBy', width: 140, render: (v) => v || '-' },
    {
      title: '操作',
      width: 260,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => onOpenDetail(row)}>查看详情</Button>
          <Button size="small" type="primary" danger onClick={() => onOpenAction(row, 'decrypt')} disabled={!row.canExport}>解密下载</Button>
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
        description="解密下载会直接把证书文件包下载到本地，内含证书正文、证书链、解密后的私钥等文件。需要输入 Google 验证码 + passphrase。"
      />

      <Card title="SSL证书申请与导出（AWS ACM）">
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="选择 AWS 环境 / 账号"
            style={{ width: 260 }}
            value={environmentId || undefined}
            onChange={(value) => {
              setEnvironmentId(value);
              const env = envOptions.find((item) => item.id === value);
              setRegion(env?.aws_region || '');
            }}
            options={envOptions.map((env) => ({ label: `${env.name} (${env.id})`, value: env.id }))}
          />
          <Input
            placeholder="Region，例如 ap-east-1 / us-east-1"
            style={{ width: 220 }}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          />
          <Input
            placeholder="搜索域名 / SAN / ARN"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 320 }}
            allowClear
          />
          <Button type="primary" onClick={() => load(keyword, environmentId, region)} loading={loading} disabled={!environmentId}>查询</Button>
          <Button onClick={() => { setKeyword(''); }} disabled={loading}>清空搜索词</Button>
        </Space>


        {queriedEnvironmentId && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message={`当前列表最近一次查询来源：${queriedEnv ? `${queriedEnv.name} (${queriedEnv.id})` : queriedEnvironmentId}`}
            description={`最近一次查询 Region：${queriedRegion || queriedEnv?.aws_region || '-'}。详细的实际 AWS 身份 / 凭证来源已输出到 backend 日志，请查看 eks-dashboard-backend/logs/pm2-out.log。`}
          />
        )}

        <Table
          rowKey="certificateArn"
          loading={loading}
          dataSource={items}
          columns={columns}
          pagination={false}
          scroll={{ x: 1800 }}
        />
      </Card>

      <Modal title="证书详情" open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={900}>
        {detail && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="AWS 环境">{detail.sourceEnvironmentId || queriedEnvironmentId || environmentId}</Descriptions.Item>
            <Descriptions.Item label="Region">{detail.sourceRegion || queriedRegion || region || '-'}</Descriptions.Item>
            <Descriptions.Item label="域名">{detail.domain}</Descriptions.Item>
            <Descriptions.Item label="SAN">{detail.sans?.join(', ') || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{detail.status || '-'}</Descriptions.Item>
            <Descriptions.Item label="证书类型">{detail.certType || '-'}</Descriptions.Item>
            <Descriptions.Item label="是否可导出">{detail.canExport ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="到期时间">{formatTime(detail.endDate)}</Descriptions.Item>
            <Descriptions.Item label="ARN">{detail.arn}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title="解密下载"
        open={actionOpen}
        onCancel={() => setActionOpen(false)}
        onOk={onSubmitAction}
        okText="确认并下载文件包"
        confirmLoading={loading}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="error"
            showIcon
            message="高风险操作"
            description="该操作会直接下载包含明文私钥的证书文件包到本地，请仅在确有导入第三方平台需求时使用。"
          />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="AWS 环境">{queriedEnv ? `${queriedEnv.name} (${queriedEnv.id})` : queriedEnvironmentId || '-'}</Descriptions.Item>
            <Descriptions.Item label="Region">{queriedRegion || queriedEnv?.aws_region || '-'}</Descriptions.Item>
            <Descriptions.Item label="证书 ARN">{actionTarget?.certificateArn || '-'}</Descriptions.Item>
          </Descriptions>
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
