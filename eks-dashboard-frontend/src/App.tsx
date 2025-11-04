import React, { useContext } from 'react';
import { Layout, Menu, Select, Spin, Alert } from 'antd';
import { Link, Routes, Route, useLocation } from 'react-router-dom';
import { DeploymentUnitOutlined, SafetyCertificateOutlined, GlobalOutlined, AimOutlined } from '@ant-design/icons';
import DeploymentListPage from './pages/DeploymentListPage';
import WindowsJumpServerPage from './pages/WindowsJumpServerPage';
import DataQueryPage from './pages/DataQueryPage';
import SecurityGroupPage from './pages/SecurityGroupPage';
import LineListPage from './pages/LineListPage';
import SiteMonitorPage from './pages/SiteMonitorPage';
import { EnvironmentContext, EnvironmentProvider } from './contexts/EnvironmentContext';
import './App.css';
import Home from './pages/Home';

const { Header, Content, Sider } = Layout;

const EnvironmentSwitcher: React.FC = () => {
  const { environments, currentEnvironment, setCurrentEnvironment, loading, error } = useContext(EnvironmentContext);

  if (loading) return <Spin size="small" />;
  if (error) return <Alert message="无法加载环境" type="error" showIcon />;

  return (
    <Select
      value={currentEnvironment?.id}
      onChange={(value) => setCurrentEnvironment(environments.find(e => e.id === value)!)}
      options={environments.map(env => ({ label: env.name, value: env.id }))}
      style={{ width: 240, marginRight: 24 }}
    />
  );
};

const AppLayout: React.FC = () => {
 const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div className="logo">运维平台</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
        >
          <Menu.Item key="/deployments" icon={<DeploymentUnitOutlined />}>
            <Link to="/deployments">EKS 部署</Link>
          </Menu.Item>
          <Menu.Item key="/jump-servers" icon={<DeploymentUnitOutlined />}>
            <Link to="/jump-servers">Windows跳板机</Link>
          </Menu.Item>
          <Menu.Item key="/data-query" icon={<DeploymentUnitOutlined />}>
            <Link to="/data-query">查询中心</Link>
          </Menu.Item>
          <Menu.Item key="/security-groups" icon={<SafetyCertificateOutlined />}>
            <Link to="/security-groups">安全组管理</Link>
          </Menu.Item>
          <Menu.Item key="/lines" icon={<GlobalOutlined />}>
            <Link to="/lines">线路列表</Link>
          </Menu.Item>
          <Menu.Item key="/site-monitors" icon={<AimOutlined />}>
            <Link to="/site-monitors">站点监控</Link>
          </Menu.Item>
        </Menu>
      </Sider>
      <Layout
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <EnvironmentSwitcher />
        </Header>
        <Content style={{ margin: '24px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 24, background: '#fff', borderRadius: '8px', flex: 1}}>
            <Routes>
              <Route path="/deployments" element={<DeploymentListPage />} />
              <Route path="/jump-servers" element={<WindowsJumpServerPage />} />
              <Route path="/data-query" element={<DataQueryPage />} />
              <Route path="/security-groups" element={<SecurityGroupPage />} />
              <Route path="/lines" element={<LineListPage />} />
              <Route path="/site-monitors" element={<SiteMonitorPage />} />
              {/* 默认路由，指向第一个菜单项 */}
              <Route path="/" element={<Home />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => (
  <EnvironmentProvider>
    <AppLayout />
  </EnvironmentProvider>
);

export default App;
