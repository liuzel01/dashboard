import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Progress, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { getLineInventory, getTenantsForEnvironment, previewDcdnSslSyncForLine, syncDcdnSslForLine } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { buildProbeDetailUrl } from '../utils/probeDashboard';
import { FilterBar, OpsTable, PageHeader } from '../components/ops';
import { formatDateTime } from '../utils/time';

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
  certExpireDaysLt?: number;
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

type DcdnSslSyncPreview = {
  domainName?: string;
  lineUrl?: string;
  namespace?: string;
  ingressName?: string;
  tlsSecretName?: string;
  uploadCertName?: string;
  k8sCertNotBefore?: string | null;
  k8sCertNotAfter?: string | null;
  dcdnCertName?: string | null;
  dcdnCertId?: string | null;
  dcdnCertExpireTime?: string | null;
};

type InventoryResponse = {
  page?: number;
  size?: number;
  total?: number;
  items?: InventoryItem[];
  warning?: string;
  probeSnapshot?: {
    sourceApi?: string;
  };
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
  const [probeSourceApi, setProbeSourceApi] = useState<string | null>(null);
  const [syncingSslLineUrl, setSyncingSslLineUrl] = useState<string | null>(null);
  const [sslPreviewLoadingLineUrl, setSslPreviewLoadingLineUrl] = useState<string | null>(null);
  const [sslPreviewOpen, setSslPreviewOpen] = useState(false);
  const [sslPreview, setSslPreview] = useState<DcdnSslSyncPreview | null>(null);
  const [sslPreviewLineUrl, setSslPreviewLineUrl] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [total, setTotal] = useState(0);
  const { currentEnvironment } = useContext(EnvironmentContext);

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
          certExpireDaysLt:
            typeof filters.certExpireDaysLt === 'number' ? filters.certExpireDaysLt : undefined,
          refresh,
        })) as InventoryResponse;
        setPage(resp.page || nextPage);
        setSize(resp.size || nextSize);
        setTotal(resp.total || 0);
        setItems(Array.isArray(resp.items) ? resp.items : []);
        setWarning(resp.warning || null);
        setProbeSourceApi(resp.probeSnapshot?.sourceApi || null);
      } catch (error: unknown) {
        const backendMsg = (error as ApiError)?.response?.data?.message;
        const msg = Array.isArray(backendMsg)
          ? backendMsg.join('; ')
          : backendMsg || (error as ApiError)?.message || '加载线路总览失败';
        setRequestError(msg);
        setItems([]);
        setTotal(0);
        setProbeSourceApi(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
      setTenants([]);
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
        const defaultTenant = normalized.find((tenant) => tenant.id === 1);
        if (defaultTenant) {
          const nextQuery: InventoryQuery = { tenantId: 1, status: true, lineUrl: '' };
          form.setFieldsValue({ tenantId: defaultTenant.id, status: true });
          setQuery(nextQuery);
          setSearched(true);
          setPage(1);
          void loadInventory(1, 20, nextQuery, false);
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setTenants([]);
        const backendMsg = (error as ApiError)?.response?.data?.message;
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
  }, [currentEnvironment?.id, form, loadInventory]);

  const handleSearch = (values: {
    tenantId?: number;
    status?: boolean;
    lineUrl?: string;
    provider?: InventoryQuery['provider'];
    availability?: InventoryQuery['availability'];
    certExpireDaysLt?: number;
  }) => {
    const nextQuery: InventoryQuery = {
      tenantId: values.tenantId,
      status: typeof values.status === 'boolean' ? values.status : undefined,
      lineUrl: values.lineUrl?.trim() || '',
      provider: values.provider,
      availability: values.availability,
      certExpireDaysLt:
        typeof values.certExpireDaysLt === 'number' && Number.isFinite(values.certExpireDaysLt)
          ? values.certExpireDaysLt
          : undefined,
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

  const handlePreviewSyncSsl = async (record: InventoryItem) => {
    const lineUrl = record.lineUrl?.trim();
    if (!lineUrl) {
      message.warning('当前行缺少 lineUrl，无法同步 SSL');
      return;
    }
    setSslPreviewLoadingLineUrl(lineUrl);
    setSslPreview(null);
    setSslPreviewLineUrl(lineUrl);
    try {
      const result = await previewDcdnSslSyncForLine({ lineUrl, namespace: 'default' }) as DcdnSslSyncPreview;
      setSslPreview(result);
      setSslPreviewOpen(true);
    } catch (error: unknown) {
      const backendMsg = (error as ApiError)?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || (error as ApiError)?.message || '解析 SSL 同步信息失败';
      message.error(msg);
      setSslPreviewLineUrl(null);
    } finally {
      setSslPreviewLoadingLineUrl(null);
    }
  };

  const handleConfirmSyncSsl = async () => {
    const lineUrl = sslPreview?.lineUrl || sslPreviewLineUrl;
    if (!lineUrl) {
      message.warning('缺少 lineUrl，无法同步 SSL');
      return;
    }
    setSyncingSslLineUrl(lineUrl);
    try {
      const result = await syncDcdnSslForLine({ lineUrl, namespace: sslPreview?.namespace || 'default' }) as { message?: string; tlsSecretName?: string; certName?: string };
      message.success(result?.message || 'SSL 证书已同步到阿里云 DCDN');
      setSslPreviewOpen(false);
      setSslPreview(null);
      setSslPreviewLineUrl(null);
      void loadInventory(page, size, query, true);
    } catch (error: unknown) {
      const backendMsg = (error as ApiError)?.response?.data?.message;
      const msg = Array.isArray(backendMsg)
        ? backendMsg.join('; ')
        : backendMsg || (error as ApiError)?.message || '同步 SSL 证书失败';
      message.error(msg);
    } finally {
      setSyncingSslLineUrl(null);
    }
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

  const toDisplayDaysLeft = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    if (value <= 0) return <Text type="danger">{value}</Text>;
    if (value <= 7) return <Text type="warning">{value}</Text>;
    return String(value);
  };

  const renderCurrentRegionSuccess = (record: InventoryItem) => {
    const success = record.successRegions ?? 0;
    const failed = record.failedRegions ?? 0;
    const unknown = record.unknownRegions ?? 0;
    const total = record.totalRegions ?? success + failed + unknown;
    if (total <= 0) return <Text type="secondary">暂无探测</Text>;
    const percentage = Number(((success / total) * 100).toFixed(1));
    const effective = success + failed;
    const detail = `当前 ${total} 个 Agent：成功 ${success}，失败 ${failed}，未知或结果过期 ${unknown}；有效覆盖 ${effective}/${total}`;
    return <Tooltip title={detail}>
      <div style={{ width: '100%' }}>
        <Progress
          percent={percentage}
          size="small"
          status={failed > 0 ? 'exception' : unknown > 0 ? 'normal' : 'success'}
          format={(value) => `${value}%`}
        />
      </div>
    </Tooltip>;
  };

  const renderAgentCoverage = (record: InventoryItem) => {
    const success = record.successRegions ?? 0;
    const failed = record.failedRegions ?? 0;
    const unknown = record.unknownRegions ?? 0;
    const total = record.totalRegions ?? success + failed + unknown;
    if (total <= 0) return <Tag>无数据</Tag>;
    const effective = success + failed;
    return <Space direction="vertical" size={4}>
      <Tag color={effective === total ? 'success' : 'warning'}>有效覆盖 {effective}/{total}</Tag>
      <Space size={2} wrap>
        <Tag color="success">成 {success}</Tag>
        <Tag color={failed > 0 ? 'error' : 'default'}>败 {failed}</Tag>
        <Tag color={unknown > 0 ? 'warning' : 'default'}>未知 {unknown}</Tag>
      </Space>
    </Space>;
  };

  const selectedTenantText = query.tenantId
    ? `${query.tenantId} - ${tenants.find((item) => item.id === query.tenantId)?.name || '未知租户'}`
    : '全部租户';

  return (
    <div>
      <PageHeader
        title="线路总览"
        description="按租户、线路、服务商和可用性查看线路库存；强制刷新仍沿用现有探测与查询流程。"
        environmentName={currentEnvironment?.name}
      />
      <Form form={form} layout="inline" initialValues={{ status: true }} onFinish={handleSearch}>
        <FilterBar
          actions={<Space>
            <Button type="primary" htmlType="submit" loading={loading}>查询</Button>
            <Button onClick={handleForceRefresh} disabled={!searched} loading={loading}>强制刷新</Button>
          </Space>}
        >
          <Form.Item name="tenantId" label="租户" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              style={{ width: 240 }}
              placeholder={tenantLoading ? '加载中...' : '全部租户'}
              loading={tenantLoading}
              showSearch
              optionFilterProp="label"
              options={tenants.map((tenant) => ({
                value: tenant.id,
                label: `${tenant.id} - ${tenant.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="lineUrl" label="线路地址" style={{ marginBottom: 0 }}>
            <Input placeholder="可选：按 lineUrl 过滤" style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="provider" label="Provider" style={{ marginBottom: 0 }}>
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
          <Form.Item name="status" label="是否启用" style={{ marginBottom: 0 }}>
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
          <Form.Item name="availability" label="可用性" style={{ marginBottom: 0 }}>
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
          <Form.Item name="certExpireDaysLt" label="证书剩余天数≤" style={{ marginBottom: 0 }}>
            <InputNumber min={0} precision={0} style={{ width: 160 }} placeholder="例如 30" />
          </Form.Item>
        </FilterBar>
      </Form>

      {tenantLoadError ? <Alert type="error" showIcon message={tenantLoadError} style={{ marginBottom: 12 }} /> : null}
      {warning ? <Alert type="info" showIcon message={warning} style={{ marginBottom: 12 }} /> : null}

      {!searched ? (
        <Space direction="vertical" size={4}>
          <Text type="secondary">系统会优先自动加载当前环境的租户 ID=1；也可以手动调整筛选条件后查询。</Text>
        </Space>
      ) : (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            当前查询范围：{selectedTenantText}
          </Text>
          <OpsTable<InventoryItem>
            rowKey={(record, index) => String(record.id || record.lineUrl || index)}
            loading={loading}
            dataSource={items}
            error={requestError}
            onRetry={() => void loadInventory(page, size, query, false)}
            emptyDescription="暂无线路数据"
            tableLayout="fixed"
            pagination={{
              current: page,
              pageSize: size,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} items`,
              onChange: (nextPage, nextSize) => {
                const resolvedSize = nextSize || size;
                void loadInventory(nextPage, resolvedSize, query, false);
              },
            }}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 90, fixed: 'left' },
              { title: '租户ID', dataIndex: 'tenantId', width: 100 },
              { title: '中文名', dataIndex: 'zh', width: 140 },
              { title: '英文名', dataIndex: 'en', width: 140 },
              { title: 'lineUrl', dataIndex: 'lineUrl', width: 260, ellipsis: true },
              { title: '状态', dataIndex: 'status', width: 100, render: renderStatusTag },
              { title: 'Provider', dataIndex: 'provider', width: 140, render: renderProviderTag },
              { title: '可用性', dataIndex: 'availability', width: 110, render: renderAvailabilityTag },
              {
                title: '当前区域成功率',
                width: 180,
                render: (_, record) => renderCurrentRegionSuccess(record),
              },
              {
                title: 'Agent 覆盖',
                width: 190,
                render: (_, record) => renderAgentCoverage(record),
              },
              {
                title: '证书到期',
                dataIndex: 'sslExpireAt',
                width: 180,
                render: (value: string | null | undefined) => formatDateTime(value),
              },
              {
                title: '剩余天数',
                dataIndex: 'sslDaysLeft',
                width: 100,
                sorter: (left, right) => {
                  const leftDays = typeof left.sslDaysLeft === 'number' ? left.sslDaysLeft : Number.POSITIVE_INFINITY;
                  const rightDays = typeof right.sslDaysLeft === 'number' ? right.sslDaysLeft : Number.POSITIVE_INFINITY;
                  return leftDays - rightDays;
                },
                render: (value: number | null | undefined) => toDisplayDaysLeft(value),
              },
              {
                title: '最近检查',
                dataIndex: 'lastCheckedAt',
                width: 180,
                render: (value: string | null | undefined) => formatDateTime(value),
              },
              { title: '错误摘要', dataIndex: 'error', width: 140, render: (value) => value || '-' },
              {
                title: '操作',
                width: 180,
                fixed: 'right',
                render: (_, record) => {
                  const lineUrl = record.lineUrl?.trim() || '';
                  const link = buildProbeDetailUrl(record.lineUrl, probeSourceApi);
                  const canSyncSsl = record.provider === 'aliyun_dcdn' && Boolean(lineUrl);
                  return (
                    <Space size={8}>
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer">
                          查看
                        </a>
                      ) : null}
                      {canSyncSsl ? (
                        <Button
                          type="link"
                          size="small"
                          loading={sslPreviewLoadingLineUrl === lineUrl || syncingSslLineUrl === lineUrl}
                          disabled={Boolean(sslPreviewLoadingLineUrl) || Boolean(syncingSslLineUrl)}
                          onClick={() => handlePreviewSyncSsl(record)}
                        >
                          同步SSL
                        </Button>
                      ) : null}
                      {!link && !canSyncSsl ? '-' : null}
                    </Space>
                  );
                },
              },
            ]}
            size="small"
            scroll={{ x: 2000 }}
          />
        </>
      )}

      <Modal
        title="同步 SSL 证书到阿里云 DCDN"
        open={sslPreviewOpen}
        onCancel={() => {
          if (syncingSslLineUrl) return;
          setSslPreviewOpen(false);
          setSslPreview(null);
          setSslPreviewLineUrl(null);
        }}
        onOk={handleConfirmSyncSsl}
        okText="确认同步"
        cancelText="取消"
        confirmLoading={Boolean(syncingSslLineUrl)}
        okButtonProps={{ disabled: !sslPreview }}
        destroyOnHidden
      >
        {sslPreview ? (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="lineUrl">{sslPreview.lineUrl || sslPreview.domainName || '-'}</Descriptions.Item>
            <Descriptions.Item label="Ingress">{sslPreview.ingressName || '-'}</Descriptions.Item>
            <Descriptions.Item label="Namespace">{sslPreview.namespace || '-'}</Descriptions.Item>
            <Descriptions.Item label="TLS Secret">{sslPreview.tlsSecretName || '-'}</Descriptions.Item>
            <Descriptions.Item label="将上传证书名称">{sslPreview.uploadCertName || '-'}</Descriptions.Item>
            <Descriptions.Item label="K8s 证书到期时间">{formatDateTime(sslPreview.k8sCertNotAfter)}</Descriptions.Item>
            <Descriptions.Item label="DCDN 当前证书到期时间">{formatDateTime(sslPreview.dcdnCertExpireTime)}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Text type="secondary">正在解析 SSL 同步信息...</Text>
        )}
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="确认后会上传当前 K8s TLS Secret 到阿里云 CAS，并重新绑定该 DCDN 域名证书。"
        />
      </Modal>
    </div>
  );
};

export default LineListPage;
