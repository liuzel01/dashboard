import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Spin, Switch, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { deleteDashboardSiteConf, getDashboardSiteConfCategories, getDashboardSiteConfList, saveDashboardSiteConf } from '../services/api';
import { FilterBar, PageHeader, RiskConfirm } from '../components/ops';

const { Text, Paragraph } = Typography;

type ValueType = 'string' | 'number' | 'boolean' | 'json';

type SiteConfItem = {
  id: number;
  confKey: string;
  confValue: string;
  valueType: ValueType;
  category?: string;
  description?: string;
  isSensitive: boolean;
  isRuntimeEditable: boolean;
  defaultValue?: string;
  validationJson?: string;
  updatedAt?: string;
};

const validateValueByType = (value: string, type: ValueType) => {
  if (type === 'number' && !Number.isFinite(Number(value))) return 'number 类型必须填写合法数字';
  if (type === 'boolean' && !['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(String(value).trim().toLowerCase())) return 'boolean 类型只支持 true/false/1/0/yes/no/on/off';
  if (type === 'json') {
    try { JSON.parse(value); } catch { return 'json 类型必须填写合法 JSON'; }
  }
  return '';
};

type SiteConfColumnKey = 'confKey' | 'category' | 'confValue' | 'description';

const defaultColumnWidths: Record<SiteConfColumnKey, number> = {
  confKey: 330,
  category: 130,
  confValue: 520,
  description: 320,
};

const minColumnWidths: Record<SiteConfColumnKey, number> = {
  confKey: 220,
  category: 100,
  confValue: 260,
  description: 180,
};

const SiteConfPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<SiteConfItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SiteConfItem | null>(null);
  const [editing, setEditing] = useState<SiteConfItem | null>(null);
  const [form] = Form.useForm();
  const valueType = Form.useWatch('valueType', form) as ValueType | undefined;
  const [columnWidths, setColumnWidths] = useState<Record<SiteConfColumnKey, number>>(defaultColumnWidths);

  const fetchCategories = async () => {
    try {
      setCategories(await getDashboardSiteConfCategories());
    } catch {
      // categories are non-critical
    }
  };

  const fetchList = async (nextPage = page, nextSize = size, nextKeyword = keyword, nextCategory = category) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboardSiteConfList({ page: nextPage, size: nextSize, keyword: nextKeyword, category: nextCategory });
      setList(data?.list || []);
      setTotal(Number(data?.total || 0));
      setPage(nextPage);
      setSize(nextSize);
    } catch (e: unknown) {
      setError((e as ApiError)?.message || '加载 siteconf 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchList(1, size, keyword, category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ valueType: 'string', isSensitive: false, isRuntimeEditable: true });
    setModalOpen(true);
  };

  const openEdit = (record: SiteConfItem) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      confKey: record.confKey,
      confValue: record.confValue,
      valueType: record.valueType,
      category: record.category,
      description: record.description,
      isSensitive: record.isSensitive,
      isRuntimeEditable: record.isRuntimeEditable,
      defaultValue: record.defaultValue,
      validationJson: record.validationJson,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (saving) return;
    const values = await form.validateFields();
    const validationError = validateValueByType(values.confValue, values.valueType);
    if (validationError) {
      message.error(validationError);
      return;
    }
    if (values.validationJson) {
      try { JSON.parse(values.validationJson); } catch { message.error('validationJson 必须是合法 JSON'); return; }
    }
    try {
      setSaving(true);
      await saveDashboardSiteConf({
        confKey: values.confKey,
        confValue: values.confValue,
        valueType: values.valueType,
        category: values.category || undefined,
        description: values.description || undefined,
        isSensitive: values.isSensitive,
        isRuntimeEditable: values.isRuntimeEditable,
        defaultValue: values.defaultValue || undefined,
        validationJson: values.validationJson || undefined,
      });
      setModalOpen(false);
      message.success('siteconf 配置已保存，正在刷新列表');
      void fetchCategories();
      void fetchList(page, size, keyword, category);
    } catch (e: unknown) {
      message.error((e as ApiError)?.message || '保存 siteconf 配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const record = deleteTarget;
    if (!record || deletingKey) return;

    try {
      setDeletingKey(record.confKey);
      const result = await deleteDashboardSiteConf(record.confKey);
      if (!result?.deleted) {
        message.warning(`未找到 ${record.confKey}，列表将刷新以确认当前状态`);
      } else {
        message.success('配置已删除');
      }
      await Promise.all([fetchCategories(), fetchList(page, size, keyword, category)]);
    } catch (e: unknown) {
      message.error((e as ApiError)?.response?.data?.message || (e as ApiError)?.message || '删除 siteconf 配置失败');
    } finally {
      setDeletingKey(null);
      setDeleteTarget(null);
    }
  };

  const renderResizableTitle = (key: SiteConfColumnKey, title: string) => (
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
            const nextWidth = Math.max(minColumnWidths[key], startWidth + moveEvent.clientX - startX);
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

  const columns = useMemo(
    () => [
      {
        title: renderResizableTitle('confKey', 'Key'),
        dataIndex: 'confKey',
        width: columnWidths.confKey,
        render: (v: string) => <Text code copyable>{v}</Text>,
      },
      {
        title: renderResizableTitle('category', '分类'),
        dataIndex: 'category',
        width: columnWidths.category,
        render: (v: string) => v ? <Tag>{v}</Tag> : '-',
      },
      {
        title: renderResizableTitle('confValue', 'Value'),
        dataIndex: 'confValue',
        width: columnWidths.confValue,
        render: (v: string, record: SiteConfItem) => (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Paragraph style={{ margin: 0 }} ellipsis={{ rows: 2, expandable: true, symbol: '展开' }} copyable={!record.isSensitive}>
              {record.isSensitive ? '********' : (v || '-')}
            </Paragraph>
            {record.isSensitive && <Tag color="orange">敏感配置</Tag>}
          </Space>
        ),
      },
      {
        title: renderResizableTitle('description', '说明'),
        dataIndex: 'description',
        width: columnWidths.description,
        ellipsis: true,
        render: (v: string) => v || '-',
      },
      {
        title: '操作',
        key: 'action',
        width: 96,
        fixed: 'right' as const,
        align: 'center' as const,
        render: (_: unknown, record: SiteConfItem) => (
          <Space size={4}>
            <Button aria-label="编辑" title="编辑" type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
            <Button aria-label="删除" title="删除" type="text" size="small" danger icon={<DeleteOutlined />} loading={deletingKey === record.confKey} disabled={Boolean(deletingKey)} onClick={() => setDeleteTarget(record)} />
          </Space>
        ),
      },
    ],
    [columnWidths, page, size, keyword, category],
  );

  return (
    <>
      <PageHeader
        title="SiteConf 配置"
        description="维护 Dashboard 运行期配置；敏感项的授权、写入和回退语义仍由现有接口与后端控制。"
        actions={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增配置</Button>}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="dashboard 内部 siteconf 配置"
        description="这里维护 dashboard 项目自身运行期配置。启动必需配置（例如 DB_*）仍保留在 .env；敏感配置仅管理员可维护，当前接口仍会返回明文，请谨慎授权。"
      />

      <FilterBar>
        <Input allowClear placeholder="搜索 key / 说明" value={keyword} onChange={(e) => setKeyword(e.target.value)} onPressEnter={() => fetchList(1, size, keyword, category)} style={{ width: 280 }} />
        <Select allowClear placeholder="分类" value={category} onChange={(v) => setCategory(v)} options={categories.map((c) => ({ label: c, value: c }))} style={{ width: 180 }} />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => fetchList(1, size, keyword, category)}>搜索</Button>
        <Button icon={<ReloadOutlined />} onClick={() => fetchList(page, size, keyword, category)}>刷新</Button>
      </FilterBar>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Spin spinning={loading}>
        <Table
          rowKey="confKey"
          columns={columns}
          dataSource={list}
          tableLayout="fixed"
          scroll={{ x: Object.values(columnWidths).reduce((sum, width) => sum + width, 96) }}
          pagination={{
            current: page,
            pageSize: size,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (n) => `共 ${n} 条`,
            onChange: (nextPage, nextSize) => fetchList(nextPage, nextSize, keyword, category),
          }}
        />
      </Spin>

      <RiskConfirm
        title="确认删除 Siteconf 配置？"
        open={Boolean(deleteTarget)}
        resourceName={deleteTarget?.confKey}
        impact="删除后将移除当前 Siteconf 配置；如该项存在环境变量或系统默认值，程序将自动回退使用它。"
        onCancel={() => !deletingKey && setDeleteTarget(null)}
        onOk={() => void handleDelete()}
        okText="确认删除"
        cancelText="取消"
        confirmLoading={Boolean(deletingKey)}
        cancelButtonProps={{ disabled: Boolean(deletingKey) }}
        maskClosable={!deletingKey}
        keyboard={!deletingKey}
        destroyOnClose
      >
        <Typography.Paragraph>
          确认删除 <Typography.Text code>{deleteTarget?.confKey}</Typography.Text>？
        </Typography.Paragraph>
      </RiskConfirm>

      <Modal
        title={editing ? '编辑 siteconf 配置' : '新增 siteconf 配置'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        maskClosable={!saving}
        keyboard={!saving}
        width={860}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Key" name="confKey" rules={[{ required: true, message: '请输入 key' }]}>
            <Input disabled={!!editing} placeholder="例如：sso.keycloak.issuer" />
          </Form.Item>
          <Form.Item label="类型" name="valueType" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={['string', 'number', 'boolean', 'json'].map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item label="Value" name="confValue" rules={[{ required: true, message: '请输入 value' }]}>
            {valueType === 'json' ? <Input.TextArea rows={8} placeholder='{"enabled":true}' /> : <Input.TextArea rows={4} />}
          </Form.Item>
          <Form.Item label="分类" name="category"><Input placeholder="例如：sso / line / aiops" /></Form.Item>
          <Form.Item label="说明" name="description"><Input.TextArea rows={3} /></Form.Item>
          <Space size={32}>
            <Form.Item label="敏感配置" name="isSensitive" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item label="运行期可编辑" name="isRuntimeEditable" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item label="默认值" name="defaultValue"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="校验规则 JSON" name="validationJson"><Input.TextArea rows={3} placeholder='例如：{"min":1000} 或 {"enum":["k8s-proxy","direct-url"]}' /></Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SiteConfPage;
