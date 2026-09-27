import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Table, Tag } from 'antd';
import { getSuperAdminLines } from '../services/api';

export type TenantLineItem = {
  id?: number | string | null;
  zh?: string;
  en?: string;
  lineUrl?: string;
  otcUrl?: string;
  status?: boolean | null;
  tenantId?: number | null;
};

type TenantLinesTableProps = {
  tenantId?: number;
  lineUrl?: string;
  enabled?: boolean;
  reloadKey?: number;
  initialPageSize?: number;
};

const TenantLinesTable: React.FC<TenantLinesTableProps> = ({
  tenantId,
  lineUrl = '',
  enabled = true,
  reloadKey = 0,
  initialPageSize = 20,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TenantLineItem[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialPageSize);
  const [total, setTotal] = useState(0);
  const currentSizeRef = useRef(initialPageSize);

  const normalizedLineUrl = useMemo(() => lineUrl.trim(), [lineUrl]);

  const load = useCallback(
    async (nextPage: number, nextSize: number) => {
      if (!tenantId) return;

      setLoading(true);
      setError(null);
      try {
        const result = (await getSuperAdminLines({
          page: nextPage,
          size: nextSize,
          lineUrl: normalizedLineUrl,
          tenantId,
        })) as {
          page?: number;
          size?: number;
          total?: number;
          items?: TenantLineItem[];
        };

        setPage(result.page || nextPage);
        setSize(result.size || nextSize);
        currentSizeRef.current = result.size || nextSize;
        setTotal(result.total || 0);
        setItems(Array.isArray(result.items) ? result.items : []);
      } catch (requestError: unknown) {
        const backendMsg = (requestError as ApiError)?.response?.data?.message;
        const msg = Array.isArray(backendMsg)
          ? backendMsg.join('; ')
          : backendMsg || '获取租户线路列表失败';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [normalizedLineUrl, tenantId],
  );

  useEffect(() => {
    if (!enabled) return;
    if (!tenantId) {
      setError(null);
      setItems([]);
      setPage(1);
      setTotal(0);
      currentSizeRef.current = initialPageSize;
      return;
    }
    void load(1, currentSizeRef.current);
  }, [enabled, initialPageSize, tenantId, normalizedLineUrl, reloadKey, load]);

  return (
    <>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} /> : null}
      <Table<TenantLineItem>
        rowKey={(record, index) => String(record.id || record.lineUrl || index)}
        loading={loading}
        dataSource={items}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          onChange: (nextPage, nextSize) => {
            const resolvedSize = nextSize || size;
            void load(nextPage, resolvedSize);
          },
        }}
        locale={{ emptyText: tenantId ? '暂无线路数据' : '请先选择租户' }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 90 },
          { title: '租户ID', dataIndex: 'tenantId', width: 100 },
          { title: '中文名', dataIndex: 'zh', width: 140 },
          { title: '英文名', dataIndex: 'en', width: 140 },
          { title: 'lineUrl', dataIndex: 'lineUrl', width: 240, ellipsis: true },
          { title: 'otcUrl', dataIndex: 'otcUrl', width: 240, ellipsis: true },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (value: boolean | null | undefined) =>
              value === true ? <Tag color="green">已开启</Tag> : <Tag>未开启</Tag>,
          },
        ]}
        size="small"
        scroll={{ x: 1100 }}
      />
    </>
  );
};

export default TenantLinesTable;
