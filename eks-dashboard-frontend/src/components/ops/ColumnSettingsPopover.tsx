import { Button, Checkbox, Popover, Space, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

export type ColumnSettingOption<Key extends string> = { label: string; value: Key };

type ColumnSettingsPopoverProps<Key extends string> = {
  options: Array<ColumnSettingOption<Key>>;
  value: Key[];
  onChange: (value: Array<string | number | boolean>) => void;
  onReset: () => void;
};

const ColumnSettingsPopover = <Key extends string>({ options, value, onChange, onReset }: ColumnSettingsPopoverProps<Key>) => (
  <Popover
    trigger="click"
    placement="bottomRight"
    title="列设置"
    content={
      <Space direction="vertical" size={8} style={{ minWidth: 260 }}>
        <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type="secondary">选择要显示的列</Typography.Text>
          <Button type="link" size="small" onClick={onReset}>恢复默认</Button>
        </Space>
        <Checkbox.Group
          options={options}
          value={value}
          onChange={onChange}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}
        />
      </Space>
    }
  >
    <Button icon={<SettingOutlined />}>列设置</Button>
  </Popover>
);

export default ColumnSettingsPopover;
