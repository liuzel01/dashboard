import React from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';

type InlineHelpTooltipProps = {
  content: React.ReactNode;
  ariaLabel: string;
  maxWidth?: number;
};

const InlineHelpTooltip: React.FC<InlineHelpTooltipProps> = ({ content, ariaLabel, maxWidth = 520 }) => (
  <Tooltip
    placement="bottomLeft"
    overlayStyle={{ maxWidth }}
    title={<div style={{ lineHeight: 1.8, whiteSpace: 'normal' }}>{content}</div>}
  >
    <InfoCircleOutlined aria-label={ariaLabel} style={{ color: '#1677ff', cursor: 'help' }} />
  </Tooltip>
);

export default InlineHelpTooltip;
