import React from 'react';
import { Alert, Button, Layout, Menu, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

type AppShellProps = {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  menuItems: MenuProps['items'];
  selectedKey: string;
  defaultOpenKeys: string[];
  headerStart: React.ReactNode;
  identityLabel: string;
  onLogout: () => void;
  authError: string | null;
  children: React.ReactNode;
};

/** Layout only: routing, permissions, environments, and business actions stay with the caller. */
const AppShell: React.FC<AppShellProps> = ({
  collapsed,
  onCollapsedChange,
  menuItems,
  selectedKey,
  defaultOpenKeys,
  headerStart,
  identityLabel,
  onLogout,
  authError,
  children,
}) => (
  <Layout className="app-shell">
    <Sider
      className="app-shell__sider"
      breakpoint="lg"
      collapsed={collapsed}
      collapsedWidth={64}
      trigger={null}
      onCollapse={onCollapsedChange}
    >
      <div className="app-shell__brand">
        {!collapsed && <div className="app-shell__brand-name">运维支持系统</div>}
        <Button
          type="text"
          className="app-shell__collapse-button"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => onCollapsedChange(!collapsed)}
        />
      </div>
      <nav className="app-shell__navigation" aria-label="主导航">
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={defaultOpenKeys}
          items={menuItems}
        />
      </nav>
    </Sider>
    <Layout className="app-shell__main-layout">
      <Header className="app-shell__header">
        <div className="app-shell__environment">{headerStart}</div>
        <Space size={12} className="app-shell__account">
          <Text type="secondary" className="app-shell__identity">{identityLabel}</Text>
          <Button onClick={onLogout}>退出登录</Button>
        </Space>
      </Header>
      <Content className="app-shell__content">
        <main className="app-shell__workspace">
          {authError && <Alert type="error" message={authError} showIcon className="app-shell__auth-error" />}
          {children}
        </main>
      </Content>
    </Layout>
  </Layout>
);

export default AppShell;
