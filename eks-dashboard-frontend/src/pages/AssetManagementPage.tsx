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
  Tag,
  Typography,
  Alert,
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
      render: (value: unknown) => (field.name === 'status' ? statusTag(String(value || 'unknown')) : renderValue(value)),
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
  const [data, setData] = useState<WangsuCdnDomainPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { message } = AntApp.useApp();

  const load = async () => {
    setLoading(true);
    try {
      setPreviewError(null);
      const next = await previewWangsuCdnDomains();
      setData(next);
      message.success(`已加载 ${next.total} 个网宿 CDN 域名`);
    } catch (e: any) {
      const errorMessage = getErrorMessage(e, '加载网宿 CDN 域名预览失败');
      setPreviewError(errorMessage);
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="CDN 域名预览"
        description="当前阶段只从网宿 OpenAPI 拉取域名列表并展示预览，不会写入资产表。AK/SK 从 系统管理 → siteconf 配置 的 cdn.wangsu.* 读取。"
      />
      <Space wrap>
        <Button type="primary" loading={loading} onClick={load}>加载网宿域名预览</Button>
        {data && <Text type="secondary">来源：{data.endpoint}；抓取时间：{formatDateTime(data.fetchedAt)}；共 {data.total} 条</Text>}
      </Space>
      {previewError && <Alert type="error" showIcon message="网宿域名预览加载失败" description={previewError} />}
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
      children: (
        <EntityTab<AssetAccount>
          title="账号"
          fields={accountFields}
          list={getAssetAccounts}
          create={createAssetAccount}
          update={updateAssetAccount}
          remove={deleteAssetAccount}
          restore={restoreAssetAccount}
          primaryField="account_name"
        />
      ),
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
      children: (
        <EntityTab<AssetDomain>
          title="域名"
          fields={domainFields}
          list={getAssetDomains}
          create={createAssetDomain}
          update={updateAssetDomain}
          remove={deleteAssetDomain}
          restore={restoreAssetDomain}
          primaryField="domain"
        />
      ),
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
