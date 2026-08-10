import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  Checkbox,
  Dropdown,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Popover,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Alert,
  Modal,
} from 'antd';
import type { FormInstance } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { SettingOutlined } from '@ant-design/icons';
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
  getTenantsForEnvironment,
  previewWangsuCdnDomains,
  previewAliyunDcdnDomains,
  previewAccountAliyunDcdnDomains,
  previewAccountAliyunEsaDomains,
  previewAccountWangsuDomains,
  syncWangsuCdnDomains,
  syncAliyunDcdnDomains,
  syncAccountAliyunDcdnDomains,
  syncAccountAliyunEsaDomains,
  syncAccountWangsuDomains,
  restoreAssetAccount,
  restoreAssetDomain,
  restoreAssetResource,
  restoreCredentialRef,
  updateAssetAccount,
  updateAssetDomain,
  updateAssetResource,
  updateCredentialRef,
} from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
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
  AliyunEsaDomainPreviewItem,
  AliyunDcdnDomainPreviewItem,
  AliyunDcdnDomainPreviewResponse,
  AliyunDcdnDomainSyncResponse,
  AccountAliyunEsaDomainPreviewResponse,
  AccountAliyunEsaDomainSyncResponse,
  AccountAliyunDcdnDomainPreviewResponse,
  AccountAliyunDcdnDomainSyncResponse,
  AccountWangsuDomainPreviewResponse,
  AccountWangsuDomainSyncResponse,
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
  multiple?: boolean;
  searchable?: boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  help?: string;
  render?: (value: unknown, record: T) => React.ReactNode;
};

interface EntityTabFormHooks<T extends AssetEntity> {
  onOpenCreate?: (form: FormInstance<Partial<T>>) => void;
  onOpenEdit?: (record: T, form: FormInstance<Partial<T>>) => void;
  onValuesChange?: (changedValues: Partial<T>, allValues: Partial<T>, form: FormInstance<Partial<T>>) => void;
  renderFilters?: (context: {
    filters: AssetListParams;
    setFilters: React.Dispatch<React.SetStateAction<AssetListParams>>;
    openCreate: () => void;
  }) => React.ReactNode;
}

type TenantOption = {
  id: number;
  name: string;
};

type TenantMapByEnvironment = Record<string, TenantOption[]>;

type EntityTabProps<T extends AssetEntity> = {
  title: string;
  fields: FieldConfig<T>[];
  list: (params: AssetListParams) => Promise<AssetListResponse<T>>;
  create: (data: Partial<T>) => Promise<unknown>;
  update: (id: number, data: Partial<T>) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  restore: (id: number) => Promise<unknown>;
  primaryField: keyof T & string;
  columnSettings?: {
    storageKey: string;
    defaultVisibleColumnKeys?: string[];
  };
} & EntityTabFormHooks<T>;

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

const domainServiceTypeOptions = [
  { value: 'cdn', label: 'CDN' },
  { value: 'dcdn', label: 'DCDN' },
  { value: 'esa', label: 'ESA' },
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
  return String(value);
};

const statusTag = (status?: string | null) => {
  const color = status === 'active' ? 'green' : status === 'disabled' || status === 'deprecated' ? 'red' : 'default';
  return <Tag color={color}>{status || 'unknown'}</Tag>;
};

const domainServiceTypeTag = (value?: string | null) => {
  const normalized = String(value || 'unknown').trim().toLowerCase() || 'unknown';
  const color = normalized === 'cdn' ? 'cyan' : normalized === 'dcdn' ? 'blue' : normalized === 'esa' ? 'purple' : 'default';
  const label = domainServiceTypeOptions.find((item) => item.value === normalized)?.label || normalized;
  return <Tag color={color}>{label}</Tag>;
};

const normalizeAccountServiceTypes = (account?: Partial<AssetAccount> | null) => {
  const raw = account?.domain_service_types;
  const list = Array.isArray(raw) ? raw : [];
  const normalized = list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (normalized.length > 0) return Array.from(new Set(normalized));
  const fallback = String(account?.domain_service_type || 'unknown').trim().toLowerCase();
  return fallback ? [fallback] : ['unknown'];
};

const renderAccountServiceTypes = (account?: Partial<AssetAccount> | null) => {
  const items = normalizeAccountServiceTypes(account);
  return <Space size={4} wrap>{items.map((item) => <span key={item}>{domainServiceTypeTag(item)}</span>)}</Space>;
};

const normalizeStringArray = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [] as string[];
};

const renderTags = (value: unknown) => {
  const tags = normalizeStringArray(value);
  if (tags.length === 0) return '-';
  return <Space size={[4, 4]} wrap>{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space>;
};

const selectFilterOption = (input: string, option?: { label?: string; value?: string | number | null }) => {
  const keyword = String(input || '').trim().toLowerCase();
  if (!keyword) return true;
  const label = String(option?.label || '').toLowerCase();
  const value = String(option?.value || '').toLowerCase();
  return label.includes(keyword) || value.includes(keyword);
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
  columnSettings,
  onOpenCreate,
  onOpenEdit,
  onValuesChange,
  renderFilters,
}: EntityTabProps<T>) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [filters, setFilters] = useState<AssetListParams>({ page: 1, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const tableFields = fields.filter((field) => field.table !== false);
  const columnOptions = [
    ...tableFields.map((field) => ({ label: field.label, value: field.name })),
    { label: '更新时间', value: 'updated_at' },
    { label: '记录状态', value: 'deleted_state' },
  ];
  const validColumnKeys = new Set(columnOptions.map((item) => item.value));
  const defaultVisibleColumnKeys = columnSettings?.defaultVisibleColumnKeys
    ? columnSettings.defaultVisibleColumnKeys.filter((key) => validColumnKeys.has(key))
    : columnOptions.map((item) => item.value);
  const normalizeVisibleColumnKeys = (values: unknown) => {
    if (!Array.isArray(values)) return defaultVisibleColumnKeys;
    const next = Array.from(new Set(values.filter((value): value is string =>
      typeof value === 'string' && validColumnKeys.has(value),
    )));
    return next.length > 0 ? next : defaultVisibleColumnKeys;
  };
  const loadVisibleColumnKeys = () => {
    if (!columnSettings || typeof window === 'undefined') return defaultVisibleColumnKeys;
    try {
      return normalizeVisibleColumnKeys(JSON.parse(window.localStorage.getItem(columnSettings.storageKey) || 'null'));
    } catch {
      return defaultVisibleColumnKeys;
    }
  };
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(loadVisibleColumnKeys);

  useEffect(() => {
    setVisibleColumnKeys(loadVisibleColumnKeys());
  }, [columnSettings?.storageKey]);

  useEffect(() => {
    if (!columnSettings || typeof window === 'undefined') return;
    window.localStorage.setItem(columnSettings.storageKey, JSON.stringify(visibleColumnKeys));
  }, [columnSettings?.storageKey, visibleColumnKeys]);

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
    onOpenCreate?.(form as FormInstance<Partial<T>>);
    setDrawerOpen(true);
  };

  const openEdit = (record: T) => {
    setEditing(record);
    form.setFieldsValue(record);
    onOpenEdit?.(record, form as FormInstance<Partial<T>>);
    setDrawerOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
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
    } catch (e: any) {
      message.error(getErrorMessage(e, `保存${title}失败`));
    } finally {
      setSubmitting(false);
    }
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

  const firstTableFieldName = tableFields[0]?.name;
  const showDeletedStateColumn = Boolean(filters.includeDeleted);

  const columns: ColumnsType<T> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 90,
      fixed: 'left',
      render: (value: unknown) => renderValue(value),
    },
    ...tableFields.map((field) => ({
      title: field.label,
      dataIndex: field.name,
      key: field.name,
      width: field.name === firstTableFieldName ? 220 : field.name === 'status' ? 110 : 180,
      fixed: field.name === firstTableFieldName ? ('left' as const) : undefined,
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
    ...(showDeletedStateColumn ? [{
      title: '记录状态',
      key: 'deleted_state',
      width: 100,
      render: (_: unknown, record: T) => (record.deleted_at ? <Tag color="red">已删除</Tag> : <Tag color="green">有效</Tag>),
    }] : []),
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

  const visibleColumns = columnSettings
    ? columns.filter((column) => {
        const key = typeof column.key === 'string' ? column.key : '';
        return key === 'id' || key === 'actions' || visibleColumnKeys.includes(key);
      })
    : columns;

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
        {renderFilters ? renderFilters({ filters, setFilters, openCreate }) : (
          <>
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
          </>
        )}
        {columnSettings && (
          <Popover
            trigger="click"
            placement="bottomRight"
            title="列设置"
            content={
              <Space direction="vertical" size={8} style={{ minWidth: 260 }}>
                <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Text type="secondary">选择要显示的列</Text>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setVisibleColumnKeys(defaultVisibleColumnKeys)}
                  >
                    恢复默认
                  </Button>
                </Space>
                <Checkbox.Group
                  options={columnOptions}
                  value={visibleColumnKeys}
                  onChange={(values) => setVisibleColumnKeys(normalizeVisibleColumnKeys(values))}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}
                />
              </Space>
            }
          >
            <Button icon={<SettingOutlined />}>列设置</Button>
          </Popover>
        )}
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={visibleColumns}
        pagination={pagination}
        scroll={{ x: 1500 }}
      />

      <Drawer
        title={editing ? `编辑${title}` : `新增${title}`}
        open={drawerOpen}
        width={620}
        onClose={() => setDrawerOpen(false)}
        extra={<Button type="primary" onClick={submit} loading={submitting}>保存</Button>}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changedValues, allValues) => onValuesChange?.(changedValues as Partial<T>, allValues as Partial<T>, form as FormInstance<Partial<T>>)}
        >
          {editing && (
            <Form.Item label="ID">
              <Input value={String(editing.id)} readOnly disabled />
            </Form.Item>
          )}
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
                <Select
                  allowClear
                  showSearch={field.searchable}
                  optionFilterProp="label"
                  filterOption={field.searchable ? selectFilterOption : undefined}
                  mode={field.multiple ? 'multiple' : undefined}
                  options={field.options}
                />
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
  const [modal, modalContextHolder] = Modal.useModal();
  const [form] = Form.useForm();
  const [items, setItems] = useState<AssetAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AssetAccount | null>(null);
  const [filters, setFilters] = useState<AssetListParams>({ page: 1, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [credentialRefs, setCredentialRefs] = useState<CredentialRef[]>([]);
  const [credentialRefsLoadError, setCredentialRefsLoadError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [accountDomainsLoading, setAccountDomainsLoading] = useState(false);
  const [accountDomainsError, setAccountDomainsError] = useState<string | null>(null);
  const [accountDomains, setAccountDomains] = useState<AssetDomain[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(10);
  const [previewData, setPreviewData] = useState<(AccountAliyunDcdnDomainPreviewResponse | AccountAliyunEsaDomainPreviewResponse | AccountWangsuDomainPreviewResponse) | null>(null);
  const [syncResult, setSyncResult] = useState<(AccountAliyunEsaDomainSyncResponse | AccountAliyunDcdnDomainSyncResponse | AccountWangsuDomainSyncResponse) | null>(null);

  const credentialRefMap = useMemo(() => new Map(credentialRefs.map((item) => [item.id, item])), [credentialRefs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAssetAccounts(filters);
      setItems(data.items);
      setTotal(data.pagination.total);

      try {
        const refs = await getCredentialRefs({ page: 1, pageSize: 200 });
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

  const loadAccountDomains = useCallback(async (accountId: number) => {
    setAccountDomainsLoading(true);
    setAccountDomainsError(null);
    try {
      const res = await getAssetDomains({ page: 1, pageSize: 100, accountId });
      setAccountDomains(res.items);
    } catch (e: any) {
      setAccountDomains([]);
      setAccountDomainsError(getErrorMessage(e, '账号关联域名加载失败'));
    } finally {
      setAccountDomainsLoading(false);
    }
  }, []);

  const refreshAccountContext = useCallback(async (accountId: number) => {
    await Promise.all([load(), loadAccountDomains(accountId)]);
  }, [load, loadAccountDomains]);

  const openCreate = async () => {
    setEditing(null);
    setAccountDomains([]);
    setAccountDomainsError(null);
    form.resetFields();
    form.setFieldsValue({ domain_service_types: ['unknown'] });
    try {
      const refs = await getCredentialRefs({ page: 1, pageSize: 200 });
      setCredentialRefs(refs.items);
      setCredentialRefsLoadError(null);
    } catch (e: any) {
      setCredentialRefs([]);
      setCredentialRefsLoadError(getErrorMessage(e, '凭证索引加载失败'));
    }
    setDrawerOpen(true);
  };

  const openEdit = async (record: AssetAccount) => {
    setEditing(record);
    form.setFieldsValue({ ...record, domain_service_types: normalizeAccountServiceTypes(record) });
    try {
      const refs = await getCredentialRefs({ page: 1, pageSize: 200 });
      setCredentialRefs(refs.items);
      setCredentialRefsLoadError(null);
    } catch (e: any) {
      setCredentialRefs([]);
      setCredentialRefsLoadError(getErrorMessage(e, '凭证索引加载失败'));
    }
    setDrawerOpen(true);
    void loadAccountDomains(record.id);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
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
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = async (record: AssetAccount, provider: 'aliyun' | 'wangsu', service: 'dcdn' | 'esa' | 'cdn' = 'dcdn') => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    setSyncResult(null);
    setPreviewPage(1);
    try {
      if (provider === 'wangsu') {
        setPreviewData(await previewAccountWangsuDomains(record.id));
      } else if (service === 'esa') {
        setPreviewData(await previewAccountAliyunEsaDomains(record.id));
      } else {
        setPreviewData(await previewAccountAliyunDcdnDomains(record.id));
      }
    } catch (e: any) {
      setPreviewData(null);
      setPreviewError(getErrorMessage(e, '账号域名预览失败'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSync = async (record: AssetAccount, provider: 'aliyun' | 'wangsu', dryRun: boolean, service: 'dcdn' | 'esa' | 'cdn' = 'dcdn') => {
    setPreviewOpen(true);
    setSyncResult(null);
    const expectedProvider = provider === 'wangsu' ? 'wangsu' : service === 'esa' ? 'aliyun_esa' : 'aliyun_dcdn';
    if (!previewData || previewData.account.id !== record.id || previewData.provider !== expectedProvider || (previewData as any).service !== service) {
      await handlePreview(record, provider, service);
    }
    if (dryRun) setPreviewLoading(true);
    else setSyncLoading(true);
    setPreviewError(null);
    try {
      const result = provider === 'wangsu'
        ? await syncAccountWangsuDomains(record.id, { dryRun })
        : service === 'esa'
        ? await syncAccountAliyunEsaDomains(record.id, { dryRun })
        : await syncAccountAliyunDcdnDomains(record.id, { dryRun, service: 'dcdn' });
      setSyncResult(result);
      message.success(`${dryRun ? 'Dry Run' : '同步'}完成：共 ${result.summary.total} 条，新增 ${result.summary.created}，更新 ${result.summary.updated}，不变 ${result.summary.unchanged}，冲突 ${result.summary.conflicts}`);
      const [nextPreview] = await Promise.all([
        provider === 'wangsu' ? previewAccountWangsuDomains(record.id) : service === 'esa' ? previewAccountAliyunEsaDomains(record.id) : previewAccountAliyunDcdnDomains(record.id),
        refreshAccountContext(record.id),
      ]);
      setPreviewData(nextPreview);
    } catch (e: any) {
      setPreviewError(getErrorMessage(e, dryRun ? '账号域名 Dry Run 失败' : '账号域名同步失败'));
    } finally {
      if (dryRun) setPreviewLoading(false);
      else setSyncLoading(false);
    }
  };

  const confirmEsaSync = (record: AssetAccount) => {
    modal.confirm({
      title: '确认同步 ESA DNS 记录到域名管理？',
      content: '将仅把 ESA DNS 记录写入 Dashboard 的资产域名表；不会修改阿里云 ESA 的 DNS、代理、源站或站点配置。不同 Provider 或其他账号归属的已有域名将跳过覆盖。',
      okText: '确认同步',
      cancelText: '取消',
      onOk: () => handleSync(record, 'aliyun', false, 'esa'),
    });
  };

  const selectedCredentialRef = editing?.credential_ref_id ? credentialRefMap.get(editing.credential_ref_id) : null;

  const columns: ColumnsType<AssetAccount> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 90, fixed: 'left', render: renderValue },
    { title: '账号名称', dataIndex: 'account_name', key: 'account_name', width: 220, ellipsis: true, fixed: 'left' },
    { title: '账号类型', dataIndex: 'account_type', key: 'account_type', width: 140 },
    { title: '服务商', dataIndex: 'provider', key: 'provider', width: 100 },
    { title: '域名服务能力', dataIndex: 'domain_service_types', key: 'domain_service_types', width: 180, render: (_value, record) => renderAccountServiceTypes(record) },
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
        const provider = String(record.provider || '').trim().toLowerCase();
        const isAliyun = provider === 'aliyun';
        const isWangsu = provider === 'wangsu';
        const hasCredential = Boolean(record.credential_ref_id);
        const serviceTypes = normalizeAccountServiceTypes(record);
        const accountStatus = String(record.status || 'unknown').trim().toLowerCase();
        const accountInactive = accountStatus !== 'active';
        const accountStatusLabel = accountStatusOptions.find((option) => option.value === accountStatus)?.label || accountStatus || '未确认';
        const accountInactiveReason = `账号当前状态为“${accountStatusLabel}”，请启用后再执行域名操作`;
        const syncDisabled = accountInactive || (!isAliyun && !isWangsu) || !hasCredential || record.deleted_at != null;
        const unsupportedReason = (!isAliyun && !isWangsu)
          ? '当前仅支持阿里云 / 网宿账号'
          : !hasCredential
          ? '请先绑定凭证索引'
          : serviceTypes.includes('unknown') && serviceTypes.length === 1
          ? '请先配置域名服务能力'
          : null;
        const normalizedServices = (isWangsu
          ? serviceTypes.filter((item) => item !== 'unknown' && (item === 'cdn' || item === 'dcdn'))
          : serviceTypes.filter((item) => item !== 'unknown'));
        const previewItems = normalizedServices.map((service) => ({
          key: `preview-${service}`,
          label: isWangsu ? '预览网宿域名' : service === 'dcdn' ? '预览DCDN域名' : '预览ESA域名',
          onClick: () => handlePreview(record, isWangsu ? 'wangsu' : 'aliyun', (isWangsu ? 'cdn' : service) as 'dcdn' | 'esa' | 'cdn'),
        }));
        const dryRunItems = normalizedServices.map((service) => ({
          key: `dryrun-${service}`,
          label: isWangsu ? '网宿 Dry Run' : service === 'dcdn' ? 'DCDN Dry Run' : 'ESA Dry Run',
          onClick: () => handleSync(record, isWangsu ? 'wangsu' : 'aliyun', true, (isWangsu ? 'cdn' : service) as 'dcdn' | 'esa' | 'cdn'),
        }));
        const syncItems = normalizedServices.map((service) => ({
          key: `sync-${service}`,
          label: isWangsu ? '同步网宿域名' : service === 'dcdn' ? '同步DCDN域名' : '同步ESA域名',
          onClick: () => isAliyun && service === 'esa'
            ? confirmEsaSync(record)
            : handleSync(record, isWangsu ? 'wangsu' : 'aliyun', false, (isWangsu ? 'cdn' : service) as 'dcdn' | 'esa' | 'cdn'),
        }));
        const previewDisabled = syncDisabled || Boolean(unsupportedReason) || previewItems.length === 0;
        const dryRunDisabled = syncDisabled || syncLoading || Boolean(unsupportedReason) || dryRunItems.length === 0;
        const syncActionDisabled = syncDisabled || syncLoading || Boolean(unsupportedReason) || syncItems.length === 0;
        const renderAccountAction = (disabled: boolean, action: React.ReactNode) => (
          accountInactive && disabled ? <Tooltip title={accountInactiveReason}><span>{action}</span></Tooltip> : action
        );
        return (
          <Space size={8} wrap>
            <Button size="small" onClick={() => void openEdit(record)}>编辑</Button>
            {renderAccountAction(previewDisabled,
              <Dropdown menu={{ items: previewItems }} disabled={previewDisabled}>
                <Button size="small" disabled={previewDisabled}>预览域名</Button>
              </Dropdown>,
            )}
            {renderAccountAction(dryRunDisabled,
              <Dropdown menu={{ items: dryRunItems }} disabled={dryRunDisabled}>
                <Button size="small" disabled={dryRunDisabled}>Dry Run</Button>
              </Dropdown>,
            )}
            {renderAccountAction(syncActionDisabled,
              <Dropdown menu={{ items: syncItems }} disabled={syncActionDisabled}>
                <Button size="small" type="primary" loading={syncLoading} disabled={syncActionDisabled}>同步域名</Button>
              </Dropdown>,
            )}
            {unsupportedReason && !record.deleted_at && <Tag color="warning">{unsupportedReason}</Tag>}
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
    <>
      {modalContextHolder}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="账号管理是账号维度域名同步主入口" description="当前支持按账号读取 siteconf 凭证并预览/同步阿里云 DCDN、ESA DNS 记录或网宿 CDN 域名。需先绑定 credential_ref_id，且对应 credential_ref.storage_type=siteconf。ESA 同步仅写入 Dashboard 资产库，不会修改云侧 DNS 或站点配置。" />
      {credentialRefsLoadError && <Alert type="warning" showIcon message="凭证索引附加信息加载失败" description="账号主列表仍可正常显示与编辑；仅凭证名称 / siteconf 路径等增强展示暂不可用。" />}
      <Space wrap>
        <Input.Search allowClear placeholder="搜索账号" style={{ width: 260 }} onSearch={(keyword) => setFilters((prev) => ({ ...prev, keyword, page: 1 }))} />
        <Input allowClear placeholder="服务商" style={{ width: 160 }} onChange={(event) => setFilters((prev) => ({ ...prev, provider: event.target.value || undefined, page: 1 }))} />
        <Input allowClear placeholder="负责人" style={{ width: 160 }} onChange={(event) => setFilters((prev) => ({ ...prev, owner: event.target.value || undefined, page: 1 }))} />
        <Select allowClear placeholder="状态" style={{ width: 150 }} options={accountStatusOptions} onChange={(status) => setFilters((prev) => ({ ...prev, status, page: 1 }))} />
        <Checkbox checked={Boolean(filters.includeDeleted)} onChange={(event) => setFilters((prev) => ({ ...prev, includeDeleted: event.target.checked, page: 1 }))}>包含已删除</Checkbox>
        <Button type="primary" onClick={() => void openCreate()}>新增</Button>
      </Space>

      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ current: filters.page || 1, pageSize: filters.pageSize || 20, total, showSizeChanger: true, onChange: (page, pageSize) => setFilters((prev) => ({ ...prev, page, pageSize })) }} scroll={{ x: 1500 }} />

      <Drawer title={editing ? '编辑账号' : '新增账号'} open={drawerOpen} width={960} onClose={() => setDrawerOpen(false)} extra={<Button type="primary" onClick={submit} loading={submitting}>保存</Button>}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {editing && (
            selectedCredentialRef ? (
              <Descriptions size="small" bordered column={2} title="绑定凭证详情">
                <Descriptions.Item label="凭证名称">{selectedCredentialRef.ref_name}</Descriptions.Item>
                <Descriptions.Item label="凭证类型">{renderValue(selectedCredentialRef.ref_type)}</Descriptions.Item>
                <Descriptions.Item label="域名服务能力">{renderAccountServiceTypes(editing)}</Descriptions.Item>
                <Descriptions.Item label="存储类型">{renderValue(selectedCredentialRef.storage_type)}</Descriptions.Item>
                <Descriptions.Item label="可见级别">{renderValue(selectedCredentialRef.visibility_level)}</Descriptions.Item>
                <Descriptions.Item label="storage_path" span={2}>{renderValue(selectedCredentialRef.storage_path)}</Descriptions.Item>
                <Descriptions.Item label="related_account_id">{renderValue(selectedCredentialRef.related_account_id)}</Descriptions.Item>
                <Descriptions.Item label="负责人">{renderValue(selectedCredentialRef.owner)}</Descriptions.Item>
              </Descriptions>
            ) : (
              <Alert
                type="warning"
                showIcon
                message="当前账号未匹配到可展示的凭证详情"
                description={editing.credential_ref_id ? `credential_ref_id=${editing.credential_ref_id}` : '该账号尚未绑定 credential_ref_id'}
              />
            )
          )}

          <Form form={form} layout="vertical">
            {editing && (
              <Form.Item label="ID">
                <Input value={String(editing.id)} readOnly disabled />
              </Form.Item>
            )}
            {accountFields.map((field) => (
              <Form.Item key={field.name} name={[field.name]} label={field.label} rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined} valuePropName={field.boolean ? 'checked' : 'value'} help={field.help}>
                {field.boolean ? <Checkbox /> : field.number ? <InputNumber min={1} style={{ width: '100%' }} /> : field.options ? <Select allowClear mode={field.multiple ? 'multiple' : undefined} options={field.options} /> : field.textarea ? <TextArea rows={3} /> : <Input placeholder={field.placeholder} />}
              </Form.Item>
            ))}
          </Form>

          {editing && (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Space direction="vertical" size={0}>
                  <Text strong>该账号关联域名</Text>
                  <Text type="secondary">{accountDomainsLoading ? '正在刷新该账号的域名落库结果…' : `当前共 ${accountDomains.length} 条`}</Text>
                </Space>
                <Button size="small" onClick={() => void refreshAccountContext(editing.id)} loading={accountDomainsLoading || loading}>刷新域名列表</Button>
              </Space>
              {accountDomainsError && <Alert type="warning" showIcon message="账号域名列表加载失败" description={accountDomainsError} />}
              <Table<AssetDomain>
                rowKey="id"
                size="small"
                loading={accountDomainsLoading}
                dataSource={accountDomains}
                pagination={{ pageSize: 5, hideOnSinglePage: true }}
                scroll={{ x: 900 }}
                columns={[
                  { title: '域名', dataIndex: 'domain', width: 220 },
                  { title: 'CDN服务商', dataIndex: 'cdn_provider', width: 120, render: renderValue },
                  { title: '环境', dataIndex: 'environment', width: 120, render: renderValue },
                  { title: '租户', dataIndex: 'tenant', width: 120, render: renderValue },
                  { title: '状态', dataIndex: 'status', width: 100, render: (value) => statusTag(String(value || 'unknown')) },
                  { title: '更新时间', dataIndex: 'updated_at', width: 170, render: (value: string | null) => formatDateTime(value) },
                ]}
              />
            </Space>
          )}
        </Space>
      </Drawer>

      <Modal title={previewData ? `账号域名预览 - ${previewData.account.account_name}` : '账号域名预览'} open={previewOpen} width={1100} onCancel={() => setPreviewOpen(false)} footer={null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {previewData && <Alert type="info" showIcon message={`账号：${previewData.account.account_name}（${previewData.account.account_identifier || '-'}）`} description={`服务：${(previewData as any).service || 'dcdn'}；Endpoint：${previewData.endpoint}；抓取时间：${formatDateTime(previewData.fetchedAt)}；${previewData.provider === 'aliyun_esa' ? `共 ${(previewData as AccountAliyunEsaDomainPreviewResponse).siteTotalCount} 个站点、${previewData.total} 条 DNS 记录` : `共 ${previewData.total} 条`}`} />}
          {syncLoading && <Alert type="info" showIcon message="正在同步域名…" description="已收到操作请求，正在拉取并写入域名数据，请稍候。同步完成后会自动刷新预览结果。" />}
          {!syncLoading && previewLoading && <Alert type="info" showIcon message="正在执行 Dry Run…" description="正在预检本次同步将产生的变更，请稍候。完成后会展示本次预检结果。" />}
          {previewError && <Alert type="error" showIcon message="账号域名操作失败" description={previewError} />}
          {syncResult && <Alert type={syncResult.summary.dryRun ? 'warning' : 'success'} showIcon message={syncResult.summary.dryRun ? 'Dry Run 结果' : '同步完成'} description={`共 ${syncResult.summary.total} 条，新增 ${syncResult.summary.created}，更新 ${syncResult.summary.updated}，不变 ${syncResult.summary.unchanged}，Provider 冲突 ${syncResult.summary.conflicts}${'accountConflicts' in syncResult.summary ? `，账号归属冲突 ${syncResult.summary.accountConflicts}` : ''}`} />}
          <Table<WangsuCdnDomainPreviewItem | AliyunDcdnDomainPreviewItem | AliyunEsaDomainPreviewItem> rowKey={(record) => ('domainId' in record ? record.domainId : 'recordId' in record ? record.recordId : undefined) || record.domain} loading={previewLoading} dataSource={previewData?.items || []} pagination={{ current: previewPage, pageSize: previewPageSize, total: previewData?.items?.length || 0, showSizeChanger: true, onChange: (page, pageSize) => { setPreviewPage(page); setPreviewPageSize(pageSize); } }} scroll={{ x: 1000 }} columns={previewData?.provider === 'wangsu' ? [
            { title: '域名', dataIndex: 'domain', width: 220 },
            { title: 'DomainId', dataIndex: 'domainId', width: 120, render: renderValue },
            { title: 'CNAME', dataIndex: 'cname', width: 220, ellipsis: true, render: renderValue },
            { title: '服务类型', dataIndex: 'serviceType', width: 120, render: renderValue },
            { title: '状态', dataIndex: 'status', width: 110, render: renderValue },
            { title: '已启用', dataIndex: 'enabled', width: 90, render: renderValue },
            { title: '最近更新时间', dataIndex: 'lastModified', width: 170, render: renderValue },
          ] : previewData?.provider === 'aliyun_esa' ? [
            { title: '域名', dataIndex: 'domain', width: 280 },
            { title: '所属站点', dataIndex: 'siteName', width: 180, render: renderValue },
            { title: '记录类型', dataIndex: 'recordType', width: 100, render: renderValue },
            { title: '源站', dataIndex: 'origin', width: 260, ellipsis: true, render: renderValue },
            { title: 'ESA CNAME', dataIndex: 'cname', width: 280, ellipsis: true, render: renderValue },
            { title: '代理', dataIndex: 'proxied', width: 80, render: (value: boolean | undefined) => value === undefined ? '-' : value ? '是' : '否' },
            { title: '站点状态', dataIndex: 'status', width: 110, render: renderValue },
            { title: 'Record ID', dataIndex: 'recordId', width: 160, render: renderValue },
            { title: '更新时间', dataIndex: 'gmtModified', width: 170, render: renderValue },
          ] : [
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
    </>
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
  const { environments, currentEnvironment } = useContext(EnvironmentContext);
  const [accounts, setAccounts] = useState<AssetAccount[]>([]);
  const [tenantsByEnvironment, setTenantsByEnvironment] = useState<TenantMapByEnvironment>({});
  const [tenantLoading, setTenantLoading] = useState(false);
  const tenantLoadingEnvironmentsRef = useRef<Set<string>>(new Set());
  const accountMap = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);
  const [selectedFormEnvironment, setSelectedFormEnvironment] = useState<string>('');
  const [domainFilterEnvironment, setDomainFilterEnvironment] = useState<string>('');
  const currentTenants = useMemo(() => {
    const envId = selectedFormEnvironment || currentEnvironment?.id;
    return envId ? (tenantsByEnvironment[envId] || []) : [];
  }, [selectedFormEnvironment, currentEnvironment?.id, tenantsByEnvironment]);
  const currentFilterTenants = useMemo(() => {
    return domainFilterEnvironment ? (tenantsByEnvironment[domainFilterEnvironment] || []) : [];
  }, [domainFilterEnvironment, tenantsByEnvironment]);
  const tenantNameMapByEnvironment = useMemo(() => {
    const result = new Map<string, Map<string, string>>();
    Object.entries(tenantsByEnvironment).forEach(([envId, list]) => {
      result.set(envId, new Map(list.map((item) => [String(item.id), item.name])));
    });
    return result;
  }, [tenantsByEnvironment]);

  useEffect(() => {
    void (async () => {
      const res = await getAssetAccounts({ page: 1, pageSize: 200 });
      setAccounts(res.items);
    })();
  }, []);

  const normalizeTenantOptions = useCallback((data: unknown) => (
    Array.isArray(data)
      ? data
          .map((item) => ({ id: Number((item as TenantOption).id), name: String((item as TenantOption).name || '') }))
          .filter((item) => Number.isInteger(item.id) && item.id > 0)
      : []
  ), []);

  const ensureTenantsLoaded = useCallback(async (environmentIds: string[]) => {
    const envIds = Array.from(new Set(environmentIds.map((item) => String(item || '').trim()).filter(Boolean)));
    const missingEnvIds = envIds.filter((envId) => !tenantsByEnvironment[envId] && !tenantLoadingEnvironmentsRef.current.has(envId));
    if (missingEnvIds.length === 0) return;

    missingEnvIds.forEach((envId) => tenantLoadingEnvironmentsRef.current.add(envId));
    setTenantLoading(true);
    try {
      const results = await Promise.all(missingEnvIds.map(async (envId) => {
        try {
          const data = await getTenantsForEnvironment(envId);
          return [envId, normalizeTenantOptions(data)] as const;
        } catch {
          return [envId, [] as TenantOption[]] as const;
        }
      }));
      setTenantsByEnvironment((prev) => {
        const next = { ...prev };
        results.forEach(([envId, list]) => {
          next[envId] = list;
        });
        return next;
      });
    } finally {
      missingEnvIds.forEach((envId) => tenantLoadingEnvironmentsRef.current.delete(envId));
      if (tenantLoadingEnvironmentsRef.current.size === 0) {
        setTenantLoading(false);
      }
    }
  }, [normalizeTenantOptions, tenantsByEnvironment]);

  useEffect(() => {
    const envId = currentEnvironment?.id;
    if (!envId) return;
    void ensureTenantsLoaded([envId]);
  }, [currentEnvironment?.id, ensureTenantsLoaded]);

  useEffect(() => {
    const envId = domainFilterEnvironment || currentEnvironment?.id || '';
    setDomainFilterEnvironment(envId);
  }, [currentEnvironment?.id]);

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

  const renderTenant = (value: unknown, record: AssetDomain) => {
    const tenantId = String(value || '').trim();
    if (!tenantId) return '-';
    const envId = String(record.environment || '').trim();
    const name = envId ? tenantNameMapByEnvironment.get(envId)?.get(tenantId) : undefined;
    return name ? `${tenantId} - ${name}` : tenantId;
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
    { name: 'environment', label: '环境', render: renderValue },
    { name: 'tenant', label: '租户', render: renderTenant },
    { name: 'business', label: '业务' },
    { name: 'tags', label: '标签', table: true, render: renderTags },
    { name: 'owner', label: '负责人' },
    { name: 'status', label: '状态', options: domainStatusOptions },
    { name: 'remark', label: '备注/同步信息', table: false, textarea: true },
  ];

  const domainFormFields = domainFieldsWithSource.filter((field) => field.label !== '同步来源');

  const domainFieldsPhase1 = domainFormFields.map((field) => {
    if (field.name === 'environment') {
      return {
        ...field,
        searchable: true,
        options: environments.map((item) => ({ label: `${item.name} (${item.id})`, value: item.id })),
        placeholder: '请选择环境',
        help: '存 dashboard environment_id；tenant 需与 environment 成对使用。',
      } as FieldConfig<AssetDomain>;
    }
    if (field.name === 'tenant') {
      return {
        ...field,
        searchable: true,
        options: currentTenants.map((item) => ({ label: `${item.id} - ${item.name}`, value: String(item.id) })),
        placeholder: selectedFormEnvironment ? '请选择租户' : '请先选择环境',
        help: '存所选 environment 下的 tenant.id。',
      } as FieldConfig<AssetDomain>;
    }
    return field;
  });

  const listDomainsPhase1 = useCallback(async (params: AssetListParams) => {
    const response = await getAssetDomains(params);
    void ensureTenantsLoaded(response.items.map((item) => String(item.environment || '')).filter(Boolean));
    return response;
  }, [ensureTenantsLoaded]);

  const handleDomainOpenCreate = useCallback((form: FormInstance<Partial<AssetDomain>>) => {
    const envId = currentEnvironment?.id || '';
    setSelectedFormEnvironment(envId);
    if (envId) {
      form.setFieldsValue({ environment: envId, tenant: undefined });
      void ensureTenantsLoaded([envId]);
    }
  }, [currentEnvironment?.id, ensureTenantsLoaded]);

  const handleDomainOpenEdit = useCallback((record: AssetDomain) => {
    const envId = String(record.environment || '').trim();
    setSelectedFormEnvironment(envId);
    if (envId) {
      void ensureTenantsLoaded([envId]);
    }
  }, [ensureTenantsLoaded]);

  const handleDomainValuesChange = useCallback((changedValues: Partial<AssetDomain>, allValues: Partial<AssetDomain>, form: FormInstance<Partial<AssetDomain>>) => {
    if (!Object.prototype.hasOwnProperty.call(changedValues, 'environment')) return;
    const nextEnvironment = String(allValues.environment || '').trim();
    const previousEnvironment = selectedFormEnvironment;
    setSelectedFormEnvironment(nextEnvironment);
    if (nextEnvironment) {
      void ensureTenantsLoaded([nextEnvironment]);
    }
    if (previousEnvironment !== nextEnvironment && allValues.tenant) {
      form.setFieldsValue({ tenant: undefined });
    }
  }, [ensureTenantsLoaded, selectedFormEnvironment]);

  const createDomainPhase1 = (data: Partial<AssetDomain>) => createAssetDomain({
    ...data,
    environment: data.environment || currentEnvironment?.id || undefined,
  });

  const updateDomainPhase1 = (id: number, data: Partial<AssetDomain>) => updateAssetDomain(id, data);

  const renderDomainFilters = useCallback(({ filters, setFilters, openCreate }: { filters: AssetListParams; setFilters: React.Dispatch<React.SetStateAction<AssetListParams>>; openCreate: () => void; }) => (
    <>
      <Input.Search
        allowClear
        placeholder="搜索域名 / 根域名"
        style={{ width: 260 }}
        onSearch={(keyword) => setFilters((prev) => ({ ...prev, keyword, page: 1 }))}
      />
      <Input
        allowClear
        placeholder="服务商"
        style={{ width: 140 }}
        onChange={(event) => setFilters((prev) => ({ ...prev, provider: event.target.value || undefined, page: 1 }))}
      />
      <Select
        allowClear
        placeholder="环境"
        style={{ width: 180 }}
        showSearch
        optionFilterProp="label"
        filterOption={selectFilterOption}
        value={filters.environment}
        options={environments.map((item) => ({ label: `${item.name} (${item.id})`, value: item.id }))}
        onChange={(value) => {
          const nextEnvironment = String(value || '');
          setDomainFilterEnvironment(nextEnvironment);
          if (nextEnvironment) {
            void ensureTenantsLoaded([nextEnvironment]);
          }
          setFilters((prev) => ({ ...prev, environment: value || undefined, tenant: undefined, page: 1 }));
        }}
      />
      <Select
        allowClear
        placeholder={filters.environment ? '租户' : '先选环境'}
        style={{ width: 180 }}
        showSearch
        optionFilterProp="label"
        filterOption={selectFilterOption}
        value={filters.tenant}
        options={currentFilterTenants.map((item) => ({ label: `${item.id} - ${item.name}`, value: String(item.id) }))}
        onChange={(value) => setFilters((prev) => ({ ...prev, tenant: value || undefined, page: 1 }))}
      />
      <Input
        allowClear
        placeholder="业务"
        style={{ width: 140 }}
        onChange={(event) => setFilters((prev) => ({ ...prev, business: event.target.value || undefined, page: 1 }))}
      />
      <Input
        allowClear
        placeholder="标签"
        style={{ width: 140 }}
        onChange={(event) => setFilters((prev) => ({ ...prev, tag: event.target.value || undefined, page: 1 }))}
      />
      <Input
        allowClear
        placeholder="负责人"
        style={{ width: 140 }}
        onChange={(event) => setFilters((prev) => ({ ...prev, owner: event.target.value || undefined, page: 1 }))}
      />
      <Select
        allowClear
        placeholder="状态"
        style={{ width: 130 }}
        showSearch
        optionFilterProp="label"
        filterOption={selectFilterOption}
        value={filters.status}
        options={domainStatusOptions}
        onChange={(status) => setFilters((prev) => ({ ...prev, status: status || undefined, page: 1 }))}
      />
      <Checkbox
        checked={Boolean(filters.includeDeleted)}
        onChange={(event) => setFilters((prev) => ({ ...prev, includeDeleted: event.target.checked, page: 1 }))}
      >
        包含已删除
      </Checkbox>
      <Button type="primary" onClick={openCreate}>新增</Button>
    </>
  ), [currentFilterTenants, ensureTenantsLoaded, environments]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon message="域名管理展示最终资产结果" description="Phase 1：environment 存 dashboard environment_id；tenant 存当前 environment 下的 tenant.id；同步来源仅作为表格展示字段，编辑框内不再单独暴露；同步不应覆盖人工分类字段。" />
      {currentEnvironment && <Alert type="success" showIcon message={`当前左上角环境：${currentEnvironment.name || currentEnvironment.id}`} description="新增域名时会默认带入该环境；但编辑框内可单独切换 environment/tenant，已不再依赖左上角环境。列表也不会因左上角环境自动过滤历史域名。" />}
      <EntityTab<AssetDomain>
        title="域名"
        fields={domainFieldsPhase1}
        list={listDomainsPhase1}
        create={createDomainPhase1}
        update={updateDomainPhase1}
        remove={deleteAssetDomain}
        restore={restoreAssetDomain}
        primaryField="domain"
        onOpenCreate={handleDomainOpenCreate}
        onOpenEdit={handleDomainOpenEdit}
        onValuesChange={handleDomainValuesChange}
        renderFilters={renderDomainFilters}
        columnSettings={{
          storageKey: 'asset-management.domain.visible-columns.v1',
          defaultVisibleColumnKeys: ['domain', 'root_domain', 'provider', 'account_id', 'environment', 'tenant', 'business', 'tags', 'owner', 'status', 'updated_at'],
        }}
      />
      {tenantLoading && <Text type="secondary">租户列表加载中…</Text>}
    </Space>
  );
};

const accountFields: FieldConfig<AssetAccount>[] = [
  { name: 'account_name', label: '账号名称', required: true },
  { name: 'account_type', label: '账号类型', options: accountTypeOptions },
  { name: 'provider', label: '服务商', placeholder: '如 wangsu / knownsec / aliyun', help: '手动输入服务商 code，建议使用稳定英文标识；例如网宿 wangsu、知道创宇 knownsec。' },
  { name: 'domain_service_types', label: '域名服务能力', options: domainServiceTypeOptions, multiple: true, help: '用于标记该账号支持哪些域名服务；若同时支持 DCDN / ESA，请多选。单次预览/同步时再显式选择目标服务。网宿账号建议使用 cdn；历史数据若为 dcdn 也兼容。' },
  { name: 'account_identifier', label: '账号标识' },
  { name: 'login_url', label: '登录地址', table: false },
  { name: 'owner', label: '负责人' },
  { name: 'department', label: '部门', table: false },
  { name: 'usage_scope', label: '使用范围', textarea: true, table: false },
  { name: 'environment_scope', label: '环境范围' },
  { name: 'credential_ref_id', label: '凭证索引ID', number: true, table: false, help: '这里填 credential_refs.id（即凭证索引这条记录自己的 ID），不是账号 ID。' },
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
  { name: 'tags', label: '标签', multiple: true, table: false, help: '补充标签，支持多选/多值提交；如 prod、shared-cert、待迁移。' },
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
  { name: 'related_account_id', label: '关联账号ID', number: true, help: '这里填 asset_accounts.id（即账号这条记录自己的 ID），不是凭证索引 ID。' },
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
