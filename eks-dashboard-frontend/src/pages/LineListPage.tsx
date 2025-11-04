import React, { useState, useEffect, useContext } from 'react';
import { Table, Form, Input, Button, Select, message, Spin, Alert, Pagination } from 'antd';
import { getLines, getTenantsForEnvironment } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';

const { Option } = Select;

const LineListPage: React.FC = () => {
  const [form] = Form.useForm();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });

  const { currentEnvironment } = useContext(EnvironmentContext);

  useEffect(() => {
    if (currentEnvironment) {
      const fetchTenants = async () => {
        try {
          const tenantsData = await getTenantsForEnvironment();
          setTenants(tenantsData);
        } catch (err) {
          message.error('无法加载租户列表');
        }
      };
      fetchTenants();
    }
  }, [currentEnvironment]);

  const fetchLines = async (values: { tenantId: number; lineUrl?: string }, page = 1, pageSize = 10) => {
    if (!values.tenantId) {
      message.error('请先选择一个租户');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getLines({ ...values, page, size: pageSize });
      // The API response seems to have a nested structure
      setLines(data.data?.list || []);
      setPagination({
        current: page,
        pageSize: pageSize,
        total: data.data?.totalCount || 0,
      });
    } catch (err) {
      setError('获取线路列表失败，请检查后端服务和配置。');
      message.error('获取线路列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (values: { tenantId: number; lineUrl?: string }) => {
    setPagination({ ...pagination, current: 1 }); // Reset to first page on new search
    fetchLines(values, 1, pagination.pageSize);
  };

  const handleTableChange = (page: number, pageSize?: number) => {
    const values = form.getFieldsValue();
    fetchLines(values, page, pageSize || pagination.pageSize);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '线路地址', dataIndex: 'lineUrl', key: 'lineUrl' },
    { title: '备注', dataIndex: 'remark', key: 'remark' },
    { title: '创建时间', dataIndex: 'createTime', key: 'createTime' },
  ];

  return (
    <div>
      <h2>线路列表</h2>
      <Form
        form={form}
        layout="inline"
        onFinish={handleSearch}
        style={{ marginBottom: 24 }}
      >
        <Form.Item
          name="tenantId"
          label="租户"
          rules={[{ required: true, message: '请选择租户' }]}
        >
          <Select style={{ width: 150 }} placeholder="选择租户">
            {tenants.map(tenant => (
              <Option key={tenant.id} value={tenant.id}>{tenant.name}</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="lineUrl" label="线路地址">
          <Input placeholder="可选，用于模糊搜索" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
        </Form.Item>
      </Form>

      {error && <Alert message={error} type="error" style={{ marginBottom: 24 }} />}

      <Spin spinning={loading}>
        <Table
          columns={columns}
          dataSource={lines}
          rowKey="id"
          pagination={false} // Use custom pagination component
        />
      </Spin>

      <Pagination
        style={{ marginTop: 16, textAlign: 'right' }}
        current={pagination.current}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onChange={handleTableChange}
        showSizeChanger
      />
    </div>
  );
};

export default LineListPage;
