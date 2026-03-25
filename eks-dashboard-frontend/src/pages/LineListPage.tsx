import React, { useContext, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Typography, message } from 'antd';
import { getTenantsForEnvironment } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import TenantLinesTable from '../components/TenantLinesTable';

type TenantOption = {
  id: number;
  name: string;
};

type QueryState = {
  tenantId?: number;
  lineUrl: string;
  reloadKey: number;
};

const { Text } = Typography;

const LineListPage: React.FC = () => {
  const [form] = Form.useForm();
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [query, setQuery] = useState<QueryState>({ lineUrl: '', reloadKey: 0 });
  const [searched, setSearched] = useState(false);
  const { currentEnvironment } = useContext(EnvironmentContext);

  useEffect(() => {
    const envId = currentEnvironment?.id;
    if (!envId) {
      setTenants([]);
      setTenantLoadError(null);
      setQuery({ lineUrl: '', reloadKey: 0 });
      setSearched(false);
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

  const handleSearch = (values: { tenantId: number; lineUrl?: string }) => {
    if (!values.tenantId) {
      message.warning('请先选择一个租户');
      return;
    }

    setSearched(true);
    setQuery((prev) => ({
      tenantId: values.tenantId,
      lineUrl: values.lineUrl?.trim() || '',
      reloadKey: prev.reloadKey + 1,
    }));
  };

  return (
    <div>
      <h2>线路列表</h2>
      <Form form={form} layout="inline" onFinish={handleSearch} style={{ marginBottom: 16 }}>
        <Form.Item name="tenantId" label="租户" rules={[{ required: true, message: '请选择租户' }]}>
          <Select
            style={{ width: 220 }}
            placeholder={tenantLoading ? '加载中...' : '选择租户'}
            loading={tenantLoading}
            options={tenants.map((tenant) => ({
              value: tenant.id,
              label: `${tenant.id} - ${tenant.name}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="lineUrl" label="线路地址">
          <Input placeholder="可选：按 lineUrl 过滤" style={{ width: 280 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
        </Form.Item>
      </Form>

      {tenantLoadError ? <Alert type="error" showIcon message={tenantLoadError} style={{ marginBottom: 12 }} /> : null}

      {!searched ? (
        <Space direction="vertical" size={4}>
          <Text type="secondary">请选择租户并点击“查询”后查看线路数据。</Text>
        </Space>
      ) : (
        <TenantLinesTable
          tenantId={query.tenantId}
          lineUrl={query.lineUrl}
          enabled={searched}
          reloadKey={query.reloadKey}
          initialPageSize={10}
        />
      )}
    </div>
  );
};

export default LineListPage;
