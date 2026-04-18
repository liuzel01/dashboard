import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { getLineInventory, getTenantsForEnvironment } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';

type TenantOption = {
  id: number;
  name: string;
};

type InventoryQuery = {
  tenantId?: number;
  status?: boolean;
  lineUrl: string;
  provider?: 'aliyun_dcdn' | 'aws_global' | 'aliyun_esa' | 'unknown';
  availability?: 'up' | 'down' | 'unknown';
};

type InventoryItem = {
  id?: number | string | null;
  tenantId?: number | null;
  zh?: string;
  en?: string;
  lineUrl?: string;
  status?: boolean | null;
  provider?: 'aliyun_dcdn' | 'aws_global' | 'aliyun_esa' | 'unknown' | null;
  sslExpireAt?: string | null;
  sslDaysLeft?: number | null;
  availability?: 'up' | 'down' | 'unknown';
  lastCheckedAt?: string | null;
  error?: string | null;
  availabilityScore?: number | null;
  successRegions?: number;
  failedRegions?: number;
  unknownRegions?: number;
  totalRegions?: number;
};

type InventoryResponse = {
  page?: number;
  size?: number;
  total?: number;
  items?: InventoryItem[];
  warning?: string;
};

const { Text } = Typography;

const LineListPage: React.FC = () => {
  const [form] = Form.useForm();
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [query, setQuery] = useState<InventoryQuery>({ lineUrl: '', status: true });
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const { currentEnvironment } = useContext(EnvironmentContext);

  useEffect(() => {
    const envId = currentEnvironment?.id;
    if (!envId) {
      setTenants([]);
      setTenantLoadError(null);
      setQuery({ lineUrl: '', status: true });
      setSearched(false);
      setItems([]);
      setWarning(null);
      setRequestError(null);
      setPage(1);
      setSize(20);
      setTotal(0);
      form.resetFields();
      return;
    }

    let cancelled = false;
    const loadTenants = async () => {
      setTenantLoading(true);
      setTenantLoadError(null);
      try {
        const data = (await getTenantsForEnvironment()) as TenantOption[];
        if (cancelled) return;
        const normalized = Array.isArray(data)
          ? data
              .map((item) => ({
                id: Number(item.id),
                name: String(item.name || ''),
              }))
              .filter((item) => Number.isInteger(item.id) && item.id > 0)
          : [];
        setTenants(normalized);
      } catch (error: any) {
        if (cancelled) return;
        setTenants([]);
        const backendMsg = error?.response?.data?.message;
        const msg = Array.isArray(backendMsg) ? backendMsg.join('; ') : backendMsg || '加载租户列表失败';
        setTenantLoadError(msg);
      } finally {
        if (!cancelled) {
          setTenantLoading(false);
        }
      }
    };

    void loadTenants();
    return () => {
      cancelled = true;
    };
  }, [currentEnvironment?.id, form]);

  const loadInventory = useCallback(
    async (
      nextPage: number,
      nextSize: number,
      filters: InventoryQuery,
      refresh = false,
    ) => {
      setLoading(true);
      setRequestError(null);
      try {
        const resp = (await getLineInventory({
          page: nextPage,
          size: nextSize,
          tenantId: filters.tenantId,
          status: typeof filters.status === 'boolean' ? filters.status : undefined,
          lineUrl: filters.lineUrl || undefined,
          provider: filters.provider,
          availability: filters.availability,
          refresh,
        })) as InventoryResponse;
        setPage(resp.page || nextPage);
        setSize(resp.size || nextSize);
        setTotal(resp.total || 0);
        setItems(Array.isArray(resp.items) ? resp.items : []);
        setWarning(resp.warning || null);
      } catch (error: any) {
        const backendMsg = error?.response?.data?.message;
        const msg = Array.isArray(backendMsg)
          ? backendMsg.join('; ')
          : backendMsg || error?.message || '加载线路总览失败';
        setRequestError(msg);
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleSearch = (values: {
    tenantId?: number;
    status?: boolean;
    lineUrl?: string;
    provider?: InventoryQuery['provider'];
    availability?: InventoryQuery['availability'];
  }) => {
    const nextQuery: InventoryQuery = {
      tenantId: values.tenantId,
      status: typeof values.status === 'boolean' ? values.status : undefined,
      lineUrl: values.lineUrl?.trim() || '',
      provider: values.provider,
      availability: values.availability,
    };
    setQuery(nextQuery);
    setSearched(true);
    void loadInventory(1, size, nextQuery, false);
  };

  const handleForceRefresh = () => {
    if (!searched) {
      message.warning('请先查询后再执行强制刷新');
      return;
    }
    void loadInventory(page, size, query, true);
  };

  const renderStatusTag = (value: boolean | null | undefined) => {
    if (value === true) return <Tag color="green">已开启</Tag>;
    if (value === false) return <Tag>未开启</Tag>;
    return <Tag>未知</Tag>;
  };

  const renderProviderTag = (value: InventoryItem['provider']) => {
    if (!value) return '-';
    if (value === 'aliyun_dcdn') return <Tag color="blue">Aliyun DCDN</Tag>;
    if (value === 'aws_global') return <Tag color="geekblue">AWS Global</Tag>;
    if (value === 'aliyun_esa') return <Tag color="purple">Aliyun ESA</Tag>;
    return <Tag>Unknown</Tag>;
  };

  const renderAvailabilityTag = (value: InventoryItem['availability']) => {
    if (value === 'up') return <Tag color="green">可用</Tag>;
    if (value === 'down') return <Tag color="red">不可用</Tag>;
    return <Tag>未知</Tag>;
  };

  const toDisplayTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const toDisplayDaysLeft = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    if (value <= 0) return <Text type="danger">{value}</Text>;
    if (value <= 7) return <Text type="warning">{value}</Text>;
    return String(value);
  };

  const toDisplayScore = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return `${value.toFixed(2)}%`;
  };

  const toSampleText = (record: InventoryItem) => {
    const success = record.successRegions ?? 0;
    const failed = record.failedRegions ?? 0;
    const unknown = record.unknownRegions ?? 0;
    const total = record.totalRegions ?? success + failed + unknown;
    if (total <= 0) return '-';
    return `${success}/${failed}/${unknown}`;
  };

  const selectedTenantText = query.tenantId
    ? `${query.tenantId} - ${tenants.find((item) => item.id === query.tenantId)?.name || '未知租户'}`
    : '全部租户';

  return (
    <div>
      <Form
        form={form}
        layout="inline"
        initialValues={{ status: true }}
        onFinish={handleSearch}
        style={{ marginBottom: 16 }}
      >
        <Form.Item name="tenantId" label="租户">
          <Select
            allowClear
            style={{ width: 240 }}
            placeholder={tenantLoading ? '加载中...' : '全部租户'}
            loading={tenantLoading}
            options={tenants.map((tenant) => ({
              value: tenant.id,
              label: `${tenant.id} - ${tenant.name}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="lineUrl" label="线路地址">
          <Input placeholder="可选：按 lineUrl 过滤" style={{ width: 260 }} />
        </Form.Item>
        <Form.Item name="provider" label="Provider">
          <Select
            allowClear
            style={{ width: 180 }}
            placeholder="全部"
            options={[
              { value: 'aliyun_dcdn', label: 'Aliyun DCDN' },
              { value: 'aws_global', label: 'AWS Global' },
              { value: 'aliyun_esa', label: 'Aliyun ESA' },
              { value: 'unknown', label: 'Unknown' },
            ]}
          />
        </Form.Item>
        <Form.Item name="status" label="是否启用">
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder="全部"
            options={[
              { value: true, label: '启用' },
              { value: false, label: '未启用' },
            ]}
          />
        </Form.Item>
        <Form.Item name="availability" label="可用性">
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder="全部"
            options={[
              { value: 'up', label: '可用' },
              { value: 'down', label: '不可用' },
              { value: 'unknown', label: '未知' },
            ]}
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
            <Button onClick={handleForceRefresh} disabled={!searched} loading={loading}>
              强制刷新
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {tenantLoadError ? <Alert type="error" showIcon message={tenantLoadError} style={{ marginBottom: 12 }} /> : null}
      {requestError ? <Alert type="error" showIcon message={requestError} style={{ marginBottom: 12 }} /> : null}
      {warning ? <Alert type="info" showIcon message={warning} style={{ marginBottom: 12 }} /> : null}

      {!searched ? (
        <Space direction="vertical" size={4}>
          <Text type="secondary">请选择筛选条件并点击“查询”查看线路总览。</Text>
        </Space>
      ) : (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            当前查询范围：{selectedTenantText}
          </Text>
          <Table<InventoryItem>
            rowKey={(record, index) => String(record.id || record.lineUrl || index)}
            loading={loading}
            dataSource={items}
            pagination={{
              current: page,
              pageSize: size,
              total,
              showSizeChanger: true,
              showTotal: (totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} items`,
              onChange: (nextPage, nextSize) => {
                const resolvedSize = nextSize || size;
                void loadInventory(nextPage, resolvedSize, query, false);
              },
            }}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 90 },
              { title: '租户ID', dataIndex: 'tenantId', width: 100 },
              { title: '中文名', dataIndex: 'zh', width: 140 },
              { title: '英文名', dataIndex: 'en', width: 140 },
              { title: 'lineUrl', dataIndex: 'lineUrl', width: 260, ellipsis: true },
              { title: '状态', dataIndex: 'status', width: 100, render: renderStatusTag },
              { title: 'Provider', dataIndex: 'provider', width: 140, render: renderProviderTag },
              { title: '可用性', dataIndex: 'availability', width: 110, render: renderAvailabilityTag },
              {
                title: '可用率',
                dataIndex: 'availabilityScore',
                width: 110,
                render: (value: number | null | undefined) => toDisplayScore(value),
              },
              {
                title: '区域样本(成/败/未知)',
                width: 170,
                render: (_, record) => toSampleText(record),
              },
              {
                title: '证书到期',
                dataIndex: 'sslExpireAt',
                width: 180,
                render: (value: string | null | undefined) => toDisplayTime(value),
              },
              {
                title: '剩余天数',
                dataIndex: 'sslDaysLeft',
                width: 100,
                render: (value: number | null | undefined) => toDisplayDaysLeft(value),
              },
              {
                title: '最近检查',
                dataIndex: 'lastCheckedAt',
                width: 180,
                render: (value: string | null | undefined) => toDisplayTime(value),
              },
              { title: '错误摘要', dataIndex: 'error', width: 140, render: (value) => value || '-' },
            ]}
            size="small"
            scroll={{ x: 1880 }}
            locale={{ emptyText: '暂无线路数据' }}
          />
        </>
      )}
    </div>
  );
};

export default LineListPage;
