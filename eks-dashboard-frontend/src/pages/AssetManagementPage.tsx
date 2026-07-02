import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Alert,
  Modal,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import {
  createAssetAccount,
  createAssetDomain,
  createAssetResource,
  createCredentialRef,
  deleteAssetAccount,
  deleteAssetDomain,
  deleteAssetResource,
  deleteCredentialRef,
  getAssetAccounts,
  getAssetChangeLogs,
  getAssetDomains,
  getAssetOverview,
  getAssetResources,
  getCredentialRefs,
  previewWangsuCdnDomains,
  previewAliyunDcdnDomains,
  previewAccountAliyunDcdnDomains,
  syncWangsuCdnDomains,
  syncAliyunDcdnDomains,
  syncAccountAliyunDcdnDomains,
  restoreAssetAccount,
  restoreAssetDomain,
  restoreAssetResource,
  restoreCredentialRef,
  updateAssetAccount,
  updateAssetDomain,
  updateAssetResource,
  updateCredentialRef,
} from '../services/api';
import type {
  AssetAccount,
  AssetChangeLog,
  AssetDomain,
  AssetListParams,
  AssetListResponse,
  AssetResource,
  CredentialRef,
  WangsuCdnDomainPreviewItem,
  WangsuCdnDomainPreviewResponse,
  WangsuCdnDomainSyncResponse,
  AliyunDcdnDomainPreviewItem,
  AliyunDcdnDomainPreviewResponse,
  AliyunDcdnDomainSyncResponse,
  AccountAliyunDcdnDomainPreviewResponse,
  AccountAliyunDcdnDomainSyncResponse,
} from '../services/api';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

type AssetEntity = {
  id: number;
  deleted_at?: string | null;
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type FieldConfig<T extends AssetEntity> = {
  name: keyof T & string;
  label: string;
  required?: boolean;
  table?: boolean;
  textarea?: boolean;
  number?: boolean;
  boolean?: boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  help?: string;
  render?: (value: unknown, record: T) => React.ReactNode;
};

type EntityTabProps<T extends AssetEntity> = {
  title: string;
  fields: FieldConfig<T>[];
  list: (params: AssetListParams) => Promise<AssetListResponse<T>>;
  create: (data: Partial<T>) => Promise<unknown>;
  update: (id: number, data: Partial<T>) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  restore: (id: number) => Promise<unknown>;
  primaryField: keyof T & string;
};

const accountTypeOptions = [
  { value: 'cloud_provider', label: '云平台账号' },
  { value: 'cdn_provider', label: 'CDN/DCDN/ESA账号' },
  { value: 'domain_registrar', label: '域名注册商' },
  { value: 'monitoring', label: '监控系统' },
  { value: 'devops', label: 'DevOps' },
  { value: 'database', label: '数据库' },
  { value: 'third_party', label: '第三方服务' },
  { value: 'other', label: '其他' },
];

const resourceTypeOptions = [
  { value: 'esa', label: 'ESA' },
  { value: 'dcdn', label: 'DCDN' },
  { value: 'cdn', label: 'CDN' },
  { value: 'dns', label: 'DNS' },
  { value: 'waf', label: 'WAF' },
  { value: 'oss', label: 'OSS' },
  { value: 'slb', label: 'SLB' },
  { value: 'ecs', label: 'ECS' },
  { value: 'rds', label: 'RDS' },
  { value: 'redis', label: 'Redis' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'kafka', label: 'Kafka' },
  { value: 'other', label: '其他' },
];

const accountStatusOptions = [
  { value: 'active', label: '在用' },
  { value: 'standby', label: '备用' },
  { value: 'disabled', label: '已停用' },
  { value: 'unknown', label: '未确认' },
];

const domainStatusOptions = [
  { value: 'active', label: '在用' },
  { value: 'standby', label: '备用' },
  { value: 'migrating', label: '迁移中' },
  { value: 'unused', label: '未使用' },
  { value: 'deprecated', label: '废弃' },
  { value: 'unknown', label: '未确认' },
];

const icpStatusOptions = [
  { value: 'filed', label: '已备案' },
  { value: 'not_filed', label: '未备案' },
  { value: 'not_required', label: '不需要备案' },
  { value: 'unknown', label: '未确认' },
];

const credentialTypeOptions = [
  { value: 'password', label: '密码' },
  { value: 'access_key', label: 'AccessKey' },
  { value: 'ssh_key', label: 'SSH Key' },
  { value: 'api_token', label: 'API Token' },
  { value: 'certificate', label: '证书' },
  { value: 'private_key', label: '私钥' },
  { value: 'mfa_recovery', label: 'MFA Recovery' },
  { value: 'other', label: '其他' },
];

const storageTypeOptions = [
  { value: 'siteconf', label: 'siteconf' },
  { value: '1password', label: '1Password' },
  { value: 'bitwarden', label: 'Bitwarden' },
  { value: 'lark_doc', label: 'Lark 文档' },
  { value: 'local_file', label: '本地文件' },
  { value: 'kms', label: 'KMS' },
  { value: 'vault', label: 'Vault' },
  { value: 'manual', label: '人工记录' },
  { value: 'other', label: '其他' },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(/\//g, '-');
};

const renderValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === 1 || value === 0) return value === 1 ? '是' : '否';
  return String(value);
};

const statusTag = (status?: string | null) => {
  const color = status === 'active' ? 'green' : status === 'disabled' || status === 'deprecated' ? 'red' : 'default';
  return <Tag color={color}>{status || 'unknown'}</Tag>;
};

const tryParseJsonObject = (value?: string | null): Record<string, any> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
};

const getDomainSourceMeta = (domain: AssetDomain) => {
  const remark = tryParseJsonObject(domain.remark);
  return {
    source: typeof remark?.source === 'string' ? remark.source : null,
    sourceProvider: typeof remark?.source === 'string' ? String(remark.source).replace(/_api$/, '') : null,
    sourceAccountId: typeof remark?.sourceAccountId === 'number' ? remark.sourceAccountId : domain.account_id,
    sourceAccountIdentifier: typeof remark?.sourceAccountIdentifier === 'string' ? remark.sourceAccountIdentifier : null,
    domainId: typeof remark?.domainId === 'string' ? remark.domainId : null,
    cname: typeof remark?.cname === 'string' ? remark.cname : null,
    raw: remark,
  };
};

function EntityTab<T extends AssetEntity>({
  title,
  fields,
  list,
  create,
  update,
  remove,
  restore,
  primaryField,
}: EntityTabProps<T>) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [filters, setFilters] = useState<AssetListParams>({ page: 1, pageSize: 20 });
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await list(filters);
      setItems(data.items);
      setTotal(data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [filters, list]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };

  const openEdit = (record: T) => {
    setEditing(record);
    form.setFieldsValue(record);
    setDrawerOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await update(editing.id, values as Partial<T>);
      message.success('已更新');
    } else {
      await create(values as Partial<T>);
      message.success('已创建');
    }
    setDrawerOpen(false);
    await load();
  };

  const handleRemove = async (record: T) => {
    await remove(record.id);
    message.success('已删除');
    await load();
  };

  const handleRestore = async (record: T) => {
    await restore(record.id);
    message.success('已恢复');
    await load();
  };

  const tableFields = fields.filter((field) => field.table !== false);

  const columns: ColumnsType<T> = [
    ...tableFields.map((field) => ({
      title: field.label,
      dataIndex: field.name,
      key: field.name,
      ellipsis: true,
      render: (value: unknown, record: T) => field.render ? field.render(value, record) : (field.name === 'status' ? statusTag(String(value || 'unknown')) : renderValue(value)),
    })),
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '状态',
      key: 'deleted_state',
      width: 90,
      render: (_, record) => (record.deleted_at ? <Tag color="red">已删除</Tag> : <Tag color="green">有效</Tag>),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 150,
      render: (_, record) => (
        <Space size={8}>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          {record.deleted_at ? (
            <Button size="small" onClick={() => handleRestore(record)}>恢复</Button>
          ) : (
            <Popconfirm title="确认删除这条资产？" onConfirm={() => handleRemove(record)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    current: filters.page || 1,
    pageSize: filters.pageSize || 20,
    total,
    showSizeChanger: true,
    onChange: (page, pageSize) => setFilters((prev) => ({ ...prev, page, pageSize })),
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Input.Search
          allowClear
          placeholder={`搜索${title}`}
          style={{ width: 260 }}
          onSearch={(keyword) => setFilters((prev) => ({ ...prev, keyword, page: 1 }))}
        />
        <Input
          allowClear
          placeholder="服务商"
          style={{ width: 160 }}
          onChange={(event) => setFilters((prev) => ({ ...prev, provider: event.target.value || undefined, page: 1 }))}
        />
        <Input
          allowClear
          placeholder="负责人"
          style={{ width: 160 }}
          onChange={(event) => setFilters((prev) => ({ ...prev, owner: event.target.value || undefined, page: 1 }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 150 }}
          options={[...accountStatusOptions, ...domainStatusOptions].filter((item, index, arr) => arr.findIndex((x) => x.value === item.value) === index)}
          onChange={(status) => setFilters((prev) => ({ ...prev, status, page: 1 }))}
        />
        <Checkbox
          checked={Boolean(filters.includeDeleted)}
          onChange={(event) => setFilters((prev) => ({ ...prev, includeDeleted: event.target.checked, page: 1 }))}
        >
          包含已删除
        </Checkbox>
        <Button type="primary" onClick={openCreate}>新增</Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={pagination}
        scroll={{ x: 1100 }}
      />

      <Drawer
        title={editing ? `编辑${title}` : `新增${title}`}
        open={drawerOpen}
        width={620}
        onClose={() => setDrawerOpen(false)}
        extra={<Button type="primary" onClick={submit}>保存</Button>}
      >
        <Form form={form} layout="vertical">
          {fields.map((field) => (
            <Form.Item
              key={field.name}
              name={[field.name]}
              label={field.label}
              rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined}
              valuePropName={field.boolean ? 'checked' : 'value'}
              help={field.help}
            >
              {field.boolean ? (
                <Checkbox />
              ) : field.number ? (
                <InputNumber min={1} style={{ width: '100%' }} />
              ) : field.options ? (
                <Select allowClear options={field.options} />
              ) : field.textarea ? (
                <TextArea rows={3} />
              ) : (
                <Input placeholder={field.placeholder} />
              )}
            </Form.Item>
          ))}
        </Form>
        {editing && (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="ID">{editing.id}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(editing.created_at)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatDateTime(editing.updated_at)}</Descriptions.Item>
            <Descriptions.Item label="主标识">{renderValue(editing[primaryField])}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </Space>
  );
}

const AccountManagementTab: React.FC = () => {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [items, setItems] = useState<AssetAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AssetAccount | null>(null);
  const [filters, setFilters] = useState<AssetListParams>({ page: 1, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [credentialRefs, setCredentialRefs] = useState<CredentialRef[]>([]);
  const [credentialRefsLoadError, setCredentialRefsLoadError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<AccountAliyunDcdnDomainPreviewResponse | null>(null);
  const [syncResult, setSyncResult] = useState<AccountAliyunDcdnDomainSyncResponse | null>(null);

  const credentialRefMap = useMemo(() => new Map(credentialRefs.map((item) => [item.id, item])), [credentialRefs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAssetAccounts(filters);
      setItems(data.items);
      setTotal(data.pagination.total);

      try {
        const refs = await getCredentialRefs({ page: 1, pageSize: 500 });
        setCredentialRefs(refs.items);
        setCredentialRefsLoadError(null);
      } catch (e: any) {
        setCredentialRefs([]);
        setCredentialRefsLoadError(getErrorMessage(e, '凭证索引加载失败'));
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };

  const openEdit = (record: AssetAccount) => {
    setEditing(record);
    form.setFieldsValue(record);
    setDrawerOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await updateAssetAccount(editing.id, values);
      message.success('已更新');
    } else {
      await createAssetAccount(values);
      message.success('已创建');
    }
    setDrawerOpen(false);
    await load();
  };

  const handlePreview = async (record: AssetAccount) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setSyncResult(null);
    try {
      setPreviewData(await previewAccountAliyunDcdnDomains(record.id));
    } catch (e: any) {
      setPreviewData(null);
      setPreviewError(getErrorMessage(e, '账号域名预览失败'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSync = async (record: AssetAccount, dryRun: boolean) => {
    setPreviewOpen(true);
    if (!previewData || previewData.account.id !== record.id) {
      await handlePreview(record);
    }
    if (dryRun) setPreviewLoading(true);
    else setSyncLoading(true);
    setPreviewError(null);
    try {
      const result = await syncAccountAliyunDcdnDomains(record.id, { dryRun });
      setSyncResult(result);
      message.success(`${dryRun ? 'Dry Run' : '同步'}完成：共 ${result.summary.total} 条，新增 ${result.summary.created}，更新 ${result.summary.updated}，不变 ${result.summary.unchanged}，冲突 ${result.summary.conflicts}`);
      if (!previewData || previewData.account.id !== record.id) {
        setPreviewData(await previewAccountAliyunDcdnDomains(record.id));
      }
    } catch (e: any) {
      setPreviewError(getErrorMessage(e, dryRun ? '账号域名 Dry Run 失败' : '账号域名同步失败'));
    } finally {
      if (dryRun) setPreviewLoading(false);
      else setSyncLoading(false);
    }
  };

  const columns: ColumnsType<AssetAccount> = [
    { title: '账号名称', dataIndex: 'account_name', key: 'account_name', width: 220, ellipsis: true, fixed: 'left' },
    { title: '账号类型', dataIndex: 'account_type', key: 'account_type', width: 140 },
    { title: '服务商', dataIndex: 'provider', key: 'provider', width: 100 },
    { title: '账号标识', dataIndex: 'account_identifier', key: 'account_identifier', width: 180, ellipsis: true, render: renderValue },
    { title: '凭证索引', dataIndex: 'credential_ref_id', key: 'credential_ref_id', width: 220, render: (value: number | null) => {
      if (!value) return '-';
      const ref = credentialRefMap.get(value);
      if (!ref) return String(value);
      return (
        <Space direction="vertical" size={0}>
          <Text>{ref.ref_name}</Text>
          <Text type="secondary">ID: {ref.id} / {ref.storage_type}</Text>
        </Space>
      );
    } },
    { title: 'siteconf 路径', dataIndex: 'credential_ref_id', key: 'credential_storage_path', width: 240, ellipsis: true, render: (value: number | null) => {
      const ref = value ? credentialRefMap.get(value) : null;
      return ref?.storage_type === 'siteconf' ? (ref.storage_path || '-') : '-';
    } },
    { title: '负责人', dataIndex: 'owner', key: 'owner', width: 120, render: renderValue },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value) => statusTag(String(value || 'unknown')) },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 170, render: (value: string | null) => formatDateTime(value) },
    {
      title: '操作', key: 'actions', fixed: 'right', width: 350,
      render: (_, record) => {
        const isAliyun = String(record.provider || '') === 'aliyun';
        const hasCredential = Boolean(record.credential_ref_id);
        const syncDisabled = !isAliyun || !hasCredential || record.deleted_at != null;
        return (
          <Space size={8} wrap>
            <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
            <Button size="small" disabled={syncDisabled} onClick={() => handlePreview(record)}>预览域名</Button>
            <Button size="small" disabled={syncDisabled || syncLoading} onClick={() => handleSync(record, true)}>Dry Run</Button>
            <Popconfirm title={`确认同步账号 ${record.account_name} 的阿里云 DCDN 域名？`} onConfirm={() => handleSync(record, false)} disabled={syncDisabled}>
              <Button size="small" type="primary" disabled={syncDisabled} loading={syncLoading}>同步域名</Button>
            </Popconfirm>
            {record.deleted_at ? (
              <Button size="small" onClick={async () => { await restoreAssetAccount(record.id); message.success('已恢复'); await load(); }}>恢复</Button>
            ) : (
              <Popconfirm title="确认删除这条资产？" onConfirm={async () => { await deleteAssetAccount(record.id); message.success('已删除'); await load(); }}>
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="账号管理是账号维度域名同步主入口" description="一期支持按阿里云账号读取 siteconf 凭证并预览/同步 DCDN 域名。需先绑定 credential_ref_id，且对应 credential_ref.storage_type=siteconf。" />
      {credentialRefsLoadError && <Alert type="warning" showIcon message="凭证索引附加信息加载失败" description="账号主列表仍可正常显示与编辑；仅凭证名称 / siteconf 路径等增强展示暂不可用。" />}
      <Space wrap>
        <Input.Search allowClear placeholder="搜索账号" style={{ width: 260 }} onSearch={(keyword) => setFilters((prev) => ({ ...prev, keyword, page: 1 }))} />
        <Input allowClear placeholder="服务商" style={{ width: 160 }} onChange={(event) => setFilters((prev) => ({ ...prev, provider: event.target.value || undefined, page: 1 }))} />
        <Input allowClear placeholder="负责人" style={{ width: 160 }} onChange={(event) => setFilters((prev) => ({ ...prev, owner: event.target.value || undefined, page: 1 }))} />
        <Select allowClear placeholder="状态" style={{ width: 150 }} options={accountStatusOptions} onChange={(status) => setFilters((prev) => ({ ...prev, status, page: 1 }))} />
        <Checkbox checked={Boolean(filters.includeDeleted)} onChange={(event) => setFilters((prev) => ({ ...prev, includeDeleted: event.target.checked, page: 1 }))}>包含已删除</Checkbox>
        <Button type="primary" onClick={openCreate}>新增</Button>
      </Space>

      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ current: filters.page || 1, pageSize: filters.pageSize || 20, total, showSizeChanger: true, onChange: (page, pageSize) => setFilters((prev) => ({ ...prev, page, pageSize })) }} scroll={{ x: 1500 }} />

      <Drawer title={editing ? '编辑账号' : '新增账号'} open={drawerOpen} width={620} onClose={() => setDrawerOpen(false)} extra={<Button type="primary" onClick={submit}>保存</Button>}>
        {editing && (() => { const ref = editing.credential_ref_id ? credentialRefMap.get(editing.credential_ref_id) : null; return ref ? <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`当前绑定凭证：${ref.ref_name}`} description={`storage_type=${ref.storage_type}；storage_path=${ref.storage_path || '-'}；related_account_id=${renderValue(ref.related_account_id)}`} /> : null; })()}
        <Form form={form} layout="vertical">
          {accountFields.map((field) => (
            <Form.Item key={field.name} name={[field.name]} label={field.label} rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined} valuePropName={field.boolean ? 'checked' : 'value'} help={field.help}>
              {field.boolean ? <Checkbox /> : field.number ? <InputNumber min={1} style={{ width: '100%' }} /> : field.options ? <Select allowClear options={field.options} /> : field.textarea ? <TextArea rows={3} /> : <Input placeholder={field.placeholder} />}
            </Form.Item>
          ))}
        </Form>
      </Drawer>

      <Modal title={previewData ? `账号域名预览 - ${previewData.account.account_name}` : '账号域名预览'} open={previewOpen} width={1100} onCancel={() => setPreviewOpen(false)} footer={null}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {previewData && <Alert type="info" showIcon message={`账号：${previewData.account.account_name}（${previewData.account.account_identifier || '-'}）`} description={`Endpoint：${previewData.endpoint}；抓取时间：${formatDateTime(previewData.fetchedAt)}；共 ${previewData.total} 条`} />}
          {previewError && <Alert type="error" showIcon message="账号域名操作失败" description={previewError} />}
          {syncResult && <Alert type={syncResult.summary.dryRun ? 'warning' : 'success'} showIcon message={syncResult.summary.dryRun ? 'Dry Run 结果' : '同步完成'} description={`共 ${syncResult.summary.total} 条，新增 ${syncResult.summary.created}，更新 ${syncResult.summary.updated}，不变 ${syncResult.summary.unchanged}，冲突 ${syncResult.summary.conflicts}`} />}
          <Table<AliyunDcdnDomainPreviewItem> rowKey={(record) => record.domainId || record.domain} loading={previewLoading} dataSource={previewData?.items || []} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 1000 }} columns={[
            { title: '域名', dataIndex: 'domain', width: 220 },
            { title: 'DomainId', dataIndex: 'domainId', width: 120, render: renderValue },
            { title: 'CNAME', dataIndex: 'cname', width: 220, ellipsis: true, render: renderValue },
            { title: '状态', dataIndex: 'status', width: 110, render: renderValue },
            { title: 'SSL', dataIndex: 'sslProtocol', width: 90, render: renderValue },
            { title: '创建时间', dataIndex: 'gmtCreated', width: 170, render: renderValue },
            { title: '更新时间', dataIndex: 'gmtModified', width: 170, render: renderValue },
          ]} />
        </Space>
      </Modal>
    </Space>
  );
};

const overviewStats = [
  { key: 'accounts', label: '账号总数' },
  { key: 'resources', label: '服务资源' },
  { key: 'domains', label: '域名总数' },
  { key: 'credentialRefs', label: '凭证索引' },
] as const;

const OverviewTab: React.FC = () => {
  const [data, setData] = useState<Awaited<ReturnType<typeof getAssetOverview>> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAssetOverview());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <Button loading={loading} onClick={load}>加载总览</Button>;
  }

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Space wrap size={32}>
        {overviewStats.map((item) => (
          <Statistic key={item.key} title={item.label} value={data[item.key].total} loading={loading} />
        ))}
        <Statistic title="未设置负责人" value={data.missingOwners.total} loading={loading} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        title={() => <Text strong>最近变更</Text>}
        dataSource={data.recentChanges}
        pagination={false}
        columns={[
          { title: '时间', dataIndex: 'created_at', render: (value: string) => formatDateTime(value) },
          { title: '资产类型', dataIndex: 'asset_type' },
          { title: '资产ID', dataIndex: 'asset_id' },
          { title: '操作', dataIndex: 'action', render: (value: string) => <Tag>{value}</Tag> },
          { title: '操作人', dataIndex: 'operator' },
        ]}
      />
    </Space>
  );
};

const getErrorMessage = (error: any, fallback: string) => {
  const serverMessage = error?.response?.data?.message;
  if (Array.isArray(serverMessage)) return serverMessage.join('；');
  if (serverMessage) return String(serverMessage);
  if (error?.response?.data?.error) return String(error.response.data.error);
  return error?.message || fallback;
};

const CdnSyncTab: React.FC = () => {
  const { message } = AntApp.useApp();

  return (
    <Tabs
      items={[
        { key: 'wangsu', label: '网宿 CDN', children: <WangsuCdnSyncPanel messageApi={message} /> },
        { key: 'aliyun_dcdn', label: '阿里云 DCDN', children: <AliyunDcdnSyncPanel messageApi={message} /> },
        { key: 'aliyun_esa', label: '阿里云 ESA（占位）', children: <AliyunEsaPlaceholder /> },
      ]}
    />
  );
};

type SyncPanelProps = { messageApi: ReturnType<typeof AntApp.useApp>['message'] };

type AliyunDcdnColumnKey = 'domain' | 'domainId' | 'cname' | 'status' | 'sslProtocol' | 'sources' | 'gmtCreated' | 'gmtModified';

const aliyunDcdnDefaultColumnWidths: Record<AliyunDcdnColumnKey, number> = {
  domain: 300,
  domainId: 150,
  cname: 340,
  status: 120,
  sslProtocol: 100,
  sources: 360,
  gmtCreated: 180,
  gmtModified: 180,
};

const aliyunDcdnMinColumnWidths: Record<AliyunDcdnColumnKey, number> = {
  domain: 220,
  domainId: 120,
  cname: 220,
  status: 100,
  sslProtocol: 80,
  sources: 220,
  gmtCreated: 150,
  gmtModified: 150,
};

const WangsuCdnSyncPanel: React.FC<SyncPanelProps> = ({ messageApi }) => {
  const [data, setData] = useState<WangsuCdnDomainPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<WangsuCdnDomainSyncResponse | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setPreviewError(null);
      const next = await previewWangsuCdnDomains();
      setData(next);
      messageApi.success(`已加载 ${next.total} 个网宿 CDN 域名`);
    } catch (e: any) {
      const errorMessage = getErrorMessage(e, '加载网宿 CDN 域名预览失败');
      setPreviewError(errorMessage);
      messageApi.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const runSync = async (dryRun: boolean) => {
    if (dryRun) setDryRunLoading(true);
    else setSyncLoading(true);
    try {
      setPreviewError(null);
      const result = await syncWangsuCdnDomains({ dryRun });
      setSyncResult(result);
      const { created, updated, unchanged, total } = result.summary;
      messageApi.success(`${dryRun ? 'Dry Run' : '同步'}完成：共 ${total} 条，新增 ${created}，更新 ${updated}，不变 ${unchanged}`);
    } catch (e: any) {
      const errorMessage = getErrorMessage(e, dryRun ? '网宿 CDN 同步预检失败' : '同步网宿 CDN 域名失败');
      setPreviewError(errorMessage);
      messageApi.error(errorMessage);
    } finally {
      if (dryRun) setDryRunLoading(false);
      else setSyncLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="网宿 CDN 域名预览"
        description="从网宿 OpenAPI 拉取域名列表，可 Dry Run 或同步到资产域名表。优先使用 siteconf 的 cdn.wangsu.access_key_id/access_key_secret 走 AKSK 鉴权。"
      />
      <Space wrap>
        <Button type="primary" loading={loading} onClick={load}>加载网宿域名预览</Button>
        <Button loading={dryRunLoading} disabled={syncLoading} onClick={() => runSync(true)}>Dry Run 同步预检</Button>
        <Popconfirm title="确认同步网宿 CDN 域名到域名管理？" description="将按域名 upsert 到资产域名表，已有域名会更新状态和 remark。" onConfirm={() => runSync(false)}>
          <Button type="primary" danger loading={syncLoading} disabled={dryRunLoading}>同步到域名管理</Button>
        </Popconfirm>
        {data && <Text type="secondary">来源：{data.endpoint}；抓取时间：{formatDateTime(data.fetchedAt)}；共 {data.total} 条</Text>}
      </Space>
      {previewError && <Alert type="error" showIcon message="网宿 CDN 操作失败" description={previewError} />}
      {syncResult && (
        <Alert
          type={syncResult.summary.dryRun ? 'warning' : 'success'}
          showIcon
          message={syncResult.summary.dryRun ? '同步预检结果' : '同步完成'}
          description={`共 ${syncResult.summary.total} 条，新增 ${syncResult.summary.created}，更新 ${syncResult.summary.updated}，不变 ${syncResult.summary.unchanged}`}
        />
      )}
      <Table<WangsuCdnDomainPreviewItem>
        rowKey={(record) => record.domainId || record.domain}
        loading={loading}
        dataSource={data?.items || []}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: 1200 }}
        columns={[
          { title: '域名', dataIndex: 'domain', width: 240, render: (value: string) => <Text copyable>{value}</Text> },
          { title: 'Domain ID', dataIndex: 'domainId', width: 150, render: renderValue },
          { title: 'CNAME', dataIndex: 'cname', width: 260, render: renderValue },
          { title: '服务类型', dataIndex: 'serviceType', width: 130, render: renderValue },
          { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => value ? <Tag>{value}</Tag> : '-' },
          { title: 'CDN状态', dataIndex: 'cdnServiceStatus', width: 130, render: (value: string) => value ? <Tag>{value}</Tag> : '-' },
          { title: '启用', dataIndex: 'enabled', width: 100, render: renderValue },
          { title: '计费区域', dataIndex: 'billingAreas', width: 160, render: renderValue },
          { title: '更新时间', dataIndex: 'lastModified', width: 180, render: renderValue },
        ]}
      />
    </Space>
  );
};

const AliyunDcdnSyncPanel: React.FC<SyncPanelProps> = ({ messageApi }) => {
  const [data, setData] = useState<AliyunDcdnDomainPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<AliyunDcdnDomainSyncResponse | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<AliyunDcdnColumnKey, number>>(aliyunDcdnDefaultColumnWidths);

  const renderResizableTitle = (key: AliyunDcdnColumnKey, title: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
      <span>{title}</span>
      <span
        title="拖拽调整列宽"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const startX = event.clientX;
          const startWidth = columnWidths[key];
          const onMouseMove = (moveEvent: MouseEvent) => {
            const nextWidth = Math.max(aliyunDcdnMinColumnWidths[key], startWidth + moveEvent.clientX - startX);
            setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
          };
          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
          };
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        }}
        style={{
          cursor: 'col-resize',
          display: 'inline-block',
          height: 18,
          marginLeft: 8,
          width: 8,
          borderRight: '2px solid #d9d9d9',
        }}
      />
    </div>
  );

  const columns = useMemo<ColumnsType<AliyunDcdnDomainPreviewItem>>(
    () => [
      { title: renderResizableTitle('domain', '域名'), dataIndex: 'domain', width: columnWidths.domain, render: (value: string) => <Text copyable>{value}</Text> },
      { title: renderResizableTitle('domainId', 'Domain ID'), dataIndex: 'domainId', width: columnWidths.domainId, render: renderValue },
      { title: renderResizableTitle('cname', 'CNAME'), dataIndex: 'cname', width: columnWidths.cname, render: renderValue },
      { title: renderResizableTitle('status', '状态'), dataIndex: 'status', width: columnWidths.status, render: (value: string) => value ? <Tag color={value === 'online' ? 'green' : undefined}>{value}</Tag> : '-' },
      { title: renderResizableTitle('sslProtocol', 'SSL'), dataIndex: 'sslProtocol', width: columnWidths.sslProtocol, render: renderValue },
      {
        title: renderResizableTitle('sources', '源站'),
        dataIndex: 'sources',
        width: columnWidths.sources,
        render: (value: unknown) => (
          <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}>
            {JSON.stringify(value || '') || '-'}
          </Paragraph>
        ),
      },
      { title: renderResizableTitle('gmtCreated', '创建时间'), dataIndex: 'gmtCreated', width: columnWidths.gmtCreated, render: renderValue },
      { title: renderResizableTitle('gmtModified', '更新时间'), dataIndex: 'gmtModified', width: columnWidths.gmtModified, render: renderValue },
    ],
    [columnWidths],
  );


  const load = async () => {
    setLoading(true);
    try {
      setPreviewError(null);
      const next = await previewAliyunDcdnDomains();
      setData(next);
      messageApi.success(`已加载 ${next.total} 个阿里云 DCDN 域名`);
    } catch (e: any) {
      const errorMessage = getErrorMessage(e, '加载阿里云 DCDN 域名预览失败');
      setPreviewError(errorMessage);
      messageApi.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const runSync = async (dryRun: boolean) => {
    if (dryRun) setDryRunLoading(true);
    else setSyncLoading(true);
    try {
      setPreviewError(null);
      const result = await syncAliyunDcdnDomains({ dryRun });
      setSyncResult(result);
      const { created, updated, unchanged, conflicts, total } = result.summary;
      messageApi.success(`${dryRun ? 'Dry Run' : '同步'}完成：共 ${total} 条，新增 ${created}，更新 ${updated}，不变 ${unchanged}，冲突 ${conflicts}`);
    } catch (e: any) {
      const errorMessage = getErrorMessage(e, dryRun ? '阿里云 DCDN 同步预检失败' : '同步阿里云 DCDN 域名失败');
      setPreviewError(errorMessage);
      messageApi.error(errorMessage);
    } finally {
      if (dryRun) setDryRunLoading(false);
      else setSyncLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="阿里云 DCDN 域名预览"
        description="从阿里云 DCDN OpenAPI 拉取域名列表。若域名已存在且 cdn_provider 不同，同步会标记 provider_conflict 并跳过覆盖，避免覆盖网宿等已有来源。"
      />
      <Space wrap>
        <Button type="primary" loading={loading} onClick={load}>加载阿里云 DCDN 域名预览</Button>
        <Button loading={dryRunLoading} disabled={syncLoading} onClick={() => runSync(true)}>Dry Run 同步预检</Button>
        <Popconfirm title="确认同步阿里云 DCDN 域名到域名管理？" description="将按域名 upsert 到资产域名表；不同 CDN provider 的已有域名会标记冲突并跳过覆盖。" onConfirm={() => runSync(false)}>
          <Button type="primary" danger loading={syncLoading} disabled={dryRunLoading}>同步到域名管理</Button>
        </Popconfirm>
        {data && <Text type="secondary">来源：{data.endpoint}；抓取时间：{formatDateTime(data.fetchedAt)}；共 {data.total} 条</Text>}
      </Space>
      {previewError && <Alert type="error" showIcon message="阿里云 DCDN 操作失败" description={previewError} />}
      {syncResult && (
        <Alert
          type={syncResult.summary.dryRun ? 'warning' : 'success'}
          showIcon
          message={syncResult.summary.dryRun ? '同步预检结果' : '同步完成'}
          description={`共 ${syncResult.summary.total} 条，新增 ${syncResult.summary.created}，更新 ${syncResult.summary.updated}，不变 ${syncResult.summary.unchanged}，冲突 ${syncResult.summary.conflicts}`}
        />
      )}
      <Table<AliyunDcdnDomainPreviewItem>
        rowKey={(record) => record.domainId || record.domain}
        loading={loading}
        dataSource={data?.items || []}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        scroll={{ x: Object.values(columnWidths).reduce((sum, width) => sum + width, 0) }}
        tableLayout="fixed"
        columns={columns}
      />
    </Space>
  );
};

const AliyunEsaPlaceholder: React.FC = () => (
  <Alert
    type="warning"
    showIcon
    message="阿里云 ESA 同步占位"
    description="ESA ListSites 接口已只读验证可用，但当前返回为站点维度，域名级同步字段仍需进一步确认。本阶段先不提供正式同步，后续再完善 ESA 域名接入。"
  />
);

const ChangeLogsTab: React.FC = () => {
  const [items, setItems] = useState<AssetChangeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ page: 1, pageSize: 20 });
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAssetChangeLogs(filters);
      setItems(data.items);
      setTotal(data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={items}
      pagination={{
        current: filters.page,
        pageSize: filters.pageSize,
        total,
        showSizeChanger: true,
        onChange: (page, pageSize) => setFilters({ page, pageSize }),
      }}
      expandable={{
        expandedRowRender: (record) => (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Paragraph copyable={{ text: JSON.stringify(record.before_data || null, null, 2) }}>
              <Text strong>Before</Text>
              <pre>{JSON.stringify(record.before_data || null, null, 2)}</pre>
            </Paragraph>
            <Paragraph copyable={{ text: JSON.stringify(record.after_data || null, null, 2) }}>
              <Text strong>After</Text>
              <pre>{JSON.stringify(record.after_data || null, null, 2)}</pre>
            </Paragraph>
          </Space>
        ),
      }}
      columns={[
        { title: '时间', dataIndex: 'created_at', width: 170, render: (value: string) => formatDateTime(value) },
        { title: '资产类型', dataIndex: 'asset_type', width: 130 },
        { title: '资产ID', dataIndex: 'asset_id', width: 100 },
        { title: '操作', dataIndex: 'action', width: 120, render: (value: string) => <Tag>{value}</Tag> },
        { title: '操作人', dataIndex: 'operator', width: 140 },
        { title: '备注', dataIndex: 'remark', render: renderValue },
      ]}
    />
  );
};

const DomainManagementTab: React.FC = () => {
  const [accounts, setAccounts] = useState<AssetAccount[]>([]);
  const accountMap = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);

  useEffect(() => {
    void (async () => {
      const res = await getAssetAccounts({ page: 1, pageSize: 500 });
      setAccounts(res.items);
    })();
  }, []);

  const renderAccount = (value: unknown, record: AssetDomain) => {
    const meta = getDomainSourceMeta(record);
    const accountId = meta.sourceAccountId ?? (typeof value === 'number' ? value : null);
    if (!accountId) return '-';
    const account = accountMap.get(accountId);
    if (!account) return String(accountId);
    return (
      <Space direction="vertical" size={0}>
        <Text>{account.account_name}</Text>
        <Text type="secondary">ID: {account.id}{account.account_identifier ? ` / ${account.account_identifier}` : ''}</Text>
      </Space>
    );
  };

  const domainFieldsWithSource: FieldConfig<AssetDomain>[] = [
    domainFields[0],
    domainFields[1],
    domainFields[2],
    { name: 'account_id', label: '来源账号', table: true, render: renderAccount },
    { name: 'resource_id', label: '关联资源ID', number: true },
    domainFields[5],
    domainFields[6],
    domainFields[7],
    domainFields[8],
    { name: 'remark', label: '同步来源', table: true, render: (_: unknown, record: AssetDomain) => {
      const meta = getDomainSourceMeta(record);
      return (
        <Space direction="vertical" size={0}>
          <Text>{meta.sourceProvider || record.cdn_provider || '-'}</Text>
          <Text type="secondary">{meta.source || '-'}</Text>
        </Space>
      );
    } },
    domainFields[9],
    domainFields[10],
    domainFields[11],
    domainFields[12],
    domainFields[13],
    domainFields[14],
    { name: 'remark', label: '备注/同步信息', table: false, textarea: true },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="域名管理展示最终资产结果" description="Phase 2 已补充来源账号与同步来源展示。同步来源优先从 remark 中的结构化 JSON 解析；若无则回退到 account_id / cdn_provider。" />
      <EntityTab<AssetDomain>
        title="域名"
        fields={domainFieldsWithSource}
        list={getAssetDomains}
        create={createAssetDomain}
        update={updateAssetDomain}
        remove={deleteAssetDomain}
        restore={restoreAssetDomain}
        primaryField="domain"
      />
    </Space>
  );
};

const accountFields: FieldConfig<AssetAccount>[] = [
  { name: 'account_name', label: '账号名称', required: true },
  { name: 'account_type', label: '账号类型', options: accountTypeOptions },
  { name: 'provider', label: '服务商', placeholder: '如 wangsu / knownsec / aliyun', help: '手动输入服务商 code，建议使用稳定英文标识；例如网宿 wangsu、知道创宇 knownsec。' },
  { name: 'account_identifier', label: '账号标识' },
  { name: 'login_url', label: '登录地址', table: false },
  { name: 'owner', label: '负责人' },
  { name: 'department', label: '部门', table: false },
  { name: 'usage_scope', label: '使用范围', textarea: true, table: false },
  { name: 'environment_scope', label: '环境范围' },
  { name: 'credential_ref_id', label: '凭证索引ID', number: true, table: false },
  { name: 'mfa_enabled', label: 'MFA', boolean: true },
  { name: 'status', label: '状态', options: accountStatusOptions },
  { name: 'remark', label: '备注', textarea: true, table: false },
];

const resourceFields: FieldConfig<AssetResource>[] = [
  { name: 'resource_name', label: '资源名称', required: true },
  { name: 'resource_type', label: '资源类型', options: resourceTypeOptions },
  { name: 'provider', label: '服务商', placeholder: '如 wangsu / knownsec / aliyun', help: '手动输入服务商 code，建议与账号管理保持一致；例如网宿 wangsu、知道创宇 knownsec。' },
  { name: 'account_id', label: '所属账号ID', number: true },
  { name: 'resource_identifier', label: '资源标识' },
  { name: 'console_url', label: '控制台链接', table: false },
  { name: 'environment', label: '环境' },
  { name: 'tenant', label: '租户' },
  { name: 'business', label: '业务' },
  { name: 'usage_desc', label: '用途说明', textarea: true, table: false },
  { name: 'owner', label: '负责人' },
  { name: 'status', label: '状态', options: accountStatusOptions },
  { name: 'remark', label: '备注', textarea: true, table: false },
];

const domainFields: FieldConfig<AssetDomain>[] = [
  { name: 'domain', label: '域名', required: true },
  { name: 'root_domain', label: '根域名' },
  { name: 'provider', label: '注册/管理服务商', placeholder: '如 aliyun / godaddy / cloudflare' },
  { name: 'account_id', label: '所属账号ID', number: true },
  { name: 'resource_id', label: '关联资源ID', number: true },
  { name: 'icp_status', label: '备案状态', options: icpStatusOptions },
  { name: 'icp_entity', label: '备案主体', table: false },
  { name: 'dns_provider', label: 'DNS服务商' },
  { name: 'cdn_provider', label: 'CDN服务商', table: false, placeholder: '如 wangsu / knownsec / aliyun_dcdn', help: '手动输入当前域名实际使用的 CDN 服务商 code。' },
  { name: 'environment', label: '环境' },
  { name: 'tenant', label: '租户' },
  { name: 'business', label: '业务' },
  { name: 'usage_desc', label: '用途说明', textarea: true, table: false },
  { name: 'owner', label: '负责人' },
  { name: 'status', label: '状态', options: domainStatusOptions },
  { name: 'remark', label: '备注', textarea: true, table: false },
];

const credentialFields: FieldConfig<CredentialRef>[] = [
  { name: 'ref_name', label: '凭证名称', required: true },
  { name: 'ref_type', label: '凭证类型', options: credentialTypeOptions },
  { name: 'storage_type', label: '存储类型', options: storageTypeOptions },
  { name: 'storage_path', label: '存储路径/条目名' },
  { name: 'related_account_id', label: '关联账号ID', number: true },
  { name: 'visibility_level', label: '可见级别' },
  { name: 'owner', label: '负责人' },
  { name: 'remark', label: '备注', textarea: true, table: false },
];

export type AssetManagementSection = 'overview' | 'accounts' | 'resources' | 'domains' | 'credential-refs' | 'cdn-sync' | 'change-logs';

type AssetManagementPageProps = {
  activeTab?: AssetManagementSection;
};

const AssetManagementPage: React.FC<AssetManagementPageProps> = ({ activeTab = 'overview' }) => {
  const tabItems = useMemo(() => [
    { key: 'overview', label: '资产总览', children: <OverviewTab /> },
    {
      key: 'accounts',
      label: '账号管理',
      children: <AccountManagementTab />,
    },
    {
      key: 'resources',
      label: '服务资源',
      children: (
        <EntityTab<AssetResource>
          title="服务资源"
          fields={resourceFields}
          list={getAssetResources}
          create={createAssetResource}
          update={updateAssetResource}
          remove={deleteAssetResource}
          restore={restoreAssetResource}
          primaryField="resource_name"
        />
      ),
    },
    {
      key: 'domains',
      label: '域名管理',
      children: <DomainManagementTab />,
    },
    {
      key: 'credential-refs',
      label: '凭证索引',
      children: (
        <EntityTab<CredentialRef>
          title="凭证索引"
          fields={credentialFields}
          list={getCredentialRefs}
          create={createCredentialRef}
          update={updateCredentialRef}
          remove={deleteCredentialRef}
          restore={restoreCredentialRef}
          primaryField="ref_name"
        />
      ),
    },
    { key: 'cdn-sync', label: 'CDN同步', children: <CdnSyncTab /> },
    { key: 'change-logs', label: '变更记录', children: <ChangeLogsTab /> },
  ], []);

  return (
    <AntApp>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Typography.Title level={3} style={{ marginTop: 0 }}>资产管理</Typography.Title>
          <Text type="secondary">轻量 CMDB 台账，仅记录凭证索引，不保存密码、AK/SK、私钥等敏感明文。</Text>
        </div>
        {tabItems.find((item) => item.key === activeTab)?.children || <OverviewTab />}
      </Space>
    </AntApp>
  );
};

export default AssetManagementPage;
