import { Alert, Empty, Table } from 'antd';
import type { TableProps } from 'antd';
import './ops-ui.css';

type OpsTableProps<RecordType extends object> = TableProps<RecordType> & {
  error?: string | null;
  onRetry?: () => void;
  emptyDescription?: string;
};

const OpsTable = <RecordType extends object>({
  error,
  onRetry,
  emptyDescription = '暂无数据',
  locale,
  scroll,
  ...tableProps
}: OpsTableProps<RecordType>) => (
  <section className="ops-table" aria-label="数据列表">
    {error && (
      <Alert
        className="ops-table__error"
        type="error"
        showIcon
        message="加载失败"
        description={error}
        action={onRetry ? <a onClick={onRetry}>重试</a> : undefined}
      />
    )}
    <Table<RecordType>
      {...tableProps}
      scroll={scroll ?? { x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />, ...locale }}
    />
  </section>
);

export default OpsTable;
