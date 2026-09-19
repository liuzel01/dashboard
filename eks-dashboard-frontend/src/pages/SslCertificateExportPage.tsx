import React, { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  createSslCertificateDecryptedDownload,
  getEnvironmentConfigs,
  getSslCertificateDetail,
  getSslCertificates,
  requestSslCertificate,
} from '../services/api';

const { Text } = Typography;

type ValidationRecord = {
  domainName: string;
  validationStatus: string;
  recordName: string;
  recordType: string;
  recordValue: string;
};

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
  validationMethod?: string;
  keyAlgorithm?: string;
  exportOption?: string;
  transparencyLogging?: string;
  validationOptions?: ValidationRecord[];
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

const DOMAIN_PATTERN = /^(\*\.)?(((?!-)[A-Za-z0-9-]{1,63}\.)+([A-Za-z0-9-]{2,63}))$/;

const normalizeDomainInput = (value?: string) => String(value || '').trim().toLowerCase();

const splitSanInput = (value?: string) =>
  Array.from(
    new Set(
      String(value || '')
        .split(/[;,\n]/)
        .map((item) => normalizeDomainInput(item))
        .filter(Boolean),
    ),
  );

const buildDnsRecordText = (records: ValidationRecord[] = []) =>
  records
    .map((row) => [`域名: ${row.domainName || '-'}`, `记录类型: ${row.recordType || '-'}`, `记录名: ${row.recordName || '-'}`, `记录值: ${row.recordValue || '-'}`].join('\n'))
    .join('\n\n');

const buildDnsRecordLineText = (record: ValidationRecord) => [`域名: ${record.domainName || '-'}`, `记录类型: ${record.recordType || '-'}`, `记录名: ${record.recordName || '-'}`, `记录值: ${record.recordValue || '-'}`].join('\n');

const SslCertificateExportPage: React.FC = () => {
  const { message } = App.useApp();

  const copyDnsRecords = async (records: ValidationRecord[] = []) => {
    const text = buildDnsRecordText(records);
    if (!text) {
      message.warning('当前没有可复制的 DNS 记录');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success('DNS 记录已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const copyDnsRecord = async (record: ValidationRecord) => {
    const text = buildDnsRecordLineText(record);
    if (!text) {
      message.warning('当前没有可复制的 DNS 记录');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success('该条 DNS 记录已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const copyText = async (text: string, successMessage: string) => {
    if (!String(text || '').trim()) {
      message.warning('当前没有可复制的内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(String(text));
      message.success(successMessage);
    } catch {
      message.error('复制失败，请手动复制');
    }
  };
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SslCertificateItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<SslCertificateItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailJustRequested, setDetailJustRequested] = useState(false);
  const [actionTarget, setActionTarget] = useState<SslCertificateItem | null>(null);
  const [actionMode, setActionMode] = useState<'decrypt' | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [form] = Form.useForm();
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm] = Form.useForm();
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

  const fetchCertificateDetail = async (certificateArn: string) => {
    if (!queriedEnvironmentId) {
      message.warning('请先点击"查询"加载证书列表');
      return null;
    }
    const resp = await getSslCertificateDetail({
      environmentId: queriedEnvironmentId,
      region: queriedRegion || undefined,
      certificateArn,
    });
    return resp;
  };

  const onOpenDetail = async (row: SslCertificateItem) => {
    setLoading(true);
    try {
      const resp = await fetchCertificateDetail(row.certificateArn);
      if (!resp) return;
      setDetail(resp);
      setDetailJustRequested(false);
      setDetailOpen(true);
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detail?.certificateArn) return;
    setLoading(true);
    try {
      const resp = await fetchCertificateDetail(detail.certificateArn);
      if (!resp) return;
      setDetail(resp);
      setDetailJustRequested(false);
      setItems((prev) => prev.map((item) => item.certificateArn === resp.certificateArn ? { ...item, ...resp } : item));
      message.success('证书详情已刷新');
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      message.error(err?.response?.data?.message || err?.message || '详情刷新失败');
    } finally {
      setLoading(false);
    }
  };


  const onOpenAction = (row: SslCertificateItem, mode: 'decrypt') => {
    if (!queriedEnvironmentId) {
      message.warning('请先点击"查询"加载证书列表');
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
      message.success('已直接下载证书文件包(zip)');
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
        description="解密下载会直接把证书文件包下载到本地,内含证书正文、证书链、解密后的私钥等文件。需要输入 Google 验证码 + passphrase。"
      />

      <Card title="SSL证书申请与导出(AWS ACM)">
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="选择 AWS 环境 / 账号"
            style={{ width: 260 }}
            value={environmentId || undefined}
            showSearch
            optionFilterProp="label"
            filterOption={(input, option) =>
              String(option?.label || '').toLowerCase().includes(input.toLowerCase())
            }
            onChange={(value) => {
              setEnvironmentId(value);
              const env = envOptions.find((item) => item.id === value);
              setRegion(env?.aws_region || '');
            }}
            options={envOptions.map((env) => ({ label: `${env.name} (${env.id})`, value: env.id }))}
          />
          <Input
            placeholder="Region,例如 ap-east-1 / us-east-1"
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
          <Button onClick={() => setRequestOpen(true)} disabled={!environmentId}>申请证书</Button>
          <Button type="primary" onClick={() => load(keyword, environmentId, region)} loading={loading} disabled={!environmentId}>查询</Button>
          <Button onClick={() => { setKeyword(''); }} disabled={loading}>清空搜索词</Button>
        </Space>



        <Table
          rowKey="certificateArn"
          loading={loading}
          dataSource={items}
          columns={columns}
          pagination={false}
          scroll={{ x: 1800 }}
        />
      </Card>

      <Modal
        title="证书详情"
        open={detailOpen}
        onCancel={() => {
          setDetailOpen(false);
          setDetailJustRequested(false);
        }}
        footer={detail ? [
          <Button key="refresh" icon={<ReloadOutlined />} onClick={refreshDetail} loading={loading}>刷新状态</Button>,
          <Button key="close" onClick={() => { setDetailOpen(false); setDetailJustRequested(false); }}>关闭</Button>,
        ] : null}
        width={980}
      >
        {detail && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {detailJustRequested && (
              <Alert
                type="success"
                showIcon
                message="AWS ACM 已受理申请"
                description="请配置下方 DNS 验证记录；配置后可直接点击“刷新状态”查看验证进度。"
              />
            )}
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="AWS 环境">{detail.sourceEnvironmentId || queriedEnvironmentId || environmentId}</Descriptions.Item>
              <Descriptions.Item label="Region">{detail.sourceRegion || queriedRegion || region || '-'}</Descriptions.Item>
              <Descriptions.Item label="域名">{detail.domain}</Descriptions.Item>
              <Descriptions.Item label="SAN">{detail.sans?.join(', ') || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">{detail.status || '-'}</Descriptions.Item>
              <Descriptions.Item label="证书类型">{detail.certType || '-'}</Descriptions.Item>
              <Descriptions.Item label="是否可导出">{detail.canExport ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="验证方法">{detail.validationMethod || '-'}</Descriptions.Item>
              <Descriptions.Item label="密钥算法">{detail.keyAlgorithm || '-'}</Descriptions.Item>
              <Descriptions.Item label="到期时间">{formatTime(detail.endDate)}</Descriptions.Item>
              <Descriptions.Item label="ARN">{detail.arn}</Descriptions.Item>
            </Descriptions>
            <div>
              <Space style={{ marginBottom: 8 }}>
                <Text strong>DNS 验证记录</Text>
                <Text type="secondary">共 {Array.isArray(detail.validationOptions) ? detail.validationOptions.length : 0} 条</Text>
                <Button size="small" onClick={() => copyDnsRecords(Array.isArray(detail.validationOptions) ? detail.validationOptions : [])}>复制全部</Button>
              </Space>
              <Table<ValidationRecord>
                size="small"
                pagination={false}
                rowKey={(row, index) => `${row.domainName}-${row.recordName}-${row.recordValue}-${index}`}
                dataSource={Array.isArray(detail.validationOptions) ? detail.validationOptions : []}
                columns={[
                  { title: '域名', dataIndex: 'domainName', width: 180 },
                  { title: '状态', dataIndex: 'validationStatus', width: 140 },
                  { title: '记录类型', dataIndex: 'recordType', width: 120 },
                  {
                    title: '记录名',
                    dataIndex: 'recordName',
                    render: (value) => (
                      <Space size={6}>
                        <Text code>{value || '-'}</Text>
                        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copyText(String(value || ''), '记录名已复制')} />
                      </Space>
                    ),
                  },
                  {
                    title: '记录值',
                    dataIndex: 'recordValue',
                    render: (value) => (
                      <Space size={6}>
                        <Text code>{value || '-'}</Text>
                        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copyText(String(value || ''), '记录值已复制')} />
                      </Space>
                    ),
                  },
                  {
                    title: '操作',
                    width: 110,
                    fixed: 'right',
                    render: (_, row) => <Button size="small" onClick={() => copyDnsRecord(row)}>复制</Button>,
                  },
                ]}
                locale={{ emptyText: '当前没有 DNS 验证记录' }}
                scroll={{ x: 1040 }}
              />
            </div>
          </Space>
        )}
      </Modal>

      <Modal
        title="申请 SSL 证书"
        open={requestOpen}
        onCancel={() => setRequestOpen(false)}
        onOk={async () => {
          if (!environmentId) {
            message.warning('请先选择 AWS 环境');
            return;
          }
          const values = await requestForm.validateFields();
          setLoading(true);
          try {
            const resp = await requestSslCertificate({
              environmentId,
              region: region || undefined,
              domain: values.domain,
              sans: values.sans,
            });
            setRequestOpen(false);
            requestForm.resetFields();
            setQueriedEnvironmentId(environmentId);
            setQueriedRegion(region || '');
            setDetail(resp as SslCertificateItem);
            setDetailJustRequested(true);
            setDetailOpen(true);
            message.success('证书申请已提交；请配置 DNS 验证记录后刷新状态');
            await load(keyword, environmentId, region);
          } catch (error) {
            const err = error as { errorFields?: Array<{ errors?: string[] }>; response?: { data?: { message?: string } }; message?: string };
            if (Array.isArray(err?.errorFields) && err.errorFields.length > 0) {
              return;
            }
            message.error(err?.response?.data?.message || err?.message || '证书申请失败');
          } finally {
            setLoading(false);
          }
        }}
        okText="确认申请"
        confirmLoading={loading}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="当前版本不会自动写 Route53 记录"
            description="申请成功后，会直接展示证书信息和需要配置的 DNS 验证记录，方便你去域名 DNS 平台手动添加。"
          />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="AWS 环境">{envOptions.find((item) => item.id === environmentId)?.name || environmentId || '-'}</Descriptions.Item>
            <Descriptions.Item label="Region">{region || '-'}</Descriptions.Item>
            <Descriptions.Item label="证书类型">公有证书（AWS ACM）</Descriptions.Item>
            <Descriptions.Item label="验证方法">DNS 验证</Descriptions.Item>
            <Descriptions.Item label="密钥算法">RSA 2048</Descriptions.Item>
            <Descriptions.Item label="允许导出">启用导出</Descriptions.Item>
            <Descriptions.Item label="标签">默认无</Descriptions.Item>
          </Descriptions>
          <Form form={requestForm} layout="vertical">
            <Form.Item
              label="主域名"
              name="domain"
              rules={[
                { required: true, message: '请输入主域名' },
                {
                  validator: async (_, value) => {
                    const domain = normalizeDomainInput(value);
                    if (!domain) return;
                    if (!DOMAIN_PATTERN.test(domain)) {
                      throw new Error('主域名格式不合法，例如 abc.com 或 *.abc.com');
                    }
                  },
                },
              ]}
            > 
              <Input placeholder="例如 abc.com" />
            </Form.Item>
            <Form.Item
              label="SAN 列表（可选）"
              name="sans"
              extra="SAN = 这张证书额外还要覆盖的域名，不是必填。比如主域名填 abc.com，这里填 *.abc.com。多个域名可用逗号、分号或换行分隔。"
              rules={[
                {
                  validator: async (_, value) => {
                    const items = splitSanInput(value);
                    const invalid = items.find((item) => !DOMAIN_PATTERN.test(item));
                    if (invalid) {
                      throw new Error(`SAN 域名格式不合法: ${invalid}`);
                    }
                  },
                },
              ]}
            >
              <Input.TextArea rows={4} placeholder="例如 *.abc.com" />
            </Form.Item>
          </Form>
        </Space>
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
            description="该操作会直接下载包含明文私钥的证书文件包到本地,请仅在确有导入第三方平台需求时使用。"
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
              <Input.Password placeholder="当次输入,不持久化" autoComplete="new-password" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </Space>
  );
};

export default SslCertificateExportPage;
