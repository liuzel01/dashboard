import React from 'react';
import { Drawer, Space } from 'antd';
import type { DrawerProps } from 'antd';
import './ops-ui.css';

type DetailDrawerProps = Omit<DrawerProps, 'children'> & {
  summary?: React.ReactNode;
  children: React.ReactNode;
};

const DetailDrawer: React.FC<DetailDrawerProps> = ({ summary, children, width = 680, ...drawerProps }) => (
  <Drawer {...drawerProps} width={width}>
    {summary && <Space wrap className="ops-detail-drawer__summary">{summary}</Space>}
    {children}
  </Drawer>
);

export default DetailDrawer;
