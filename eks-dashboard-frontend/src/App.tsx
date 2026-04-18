import React, { useContext } from 'react';
import { Layout, Menu, Select, Spin, Alert, Space, Button, Typography } from 'antd';
import { Link, Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { DeploymentUnitOutlined, SafetyCertificateOutlined, GlobalOutlined, AimOutlined, SettingOutlined, CloudUploadOutlined, TeamOutlined, RobotOutlined } from '@ant-design/icons';
import DeploymentListPage from './pages/DeploymentListPage';
import WindowsJumpServerPage from './pages/WindowsJumpServerPage';
import DataQueryPage from './pages/DataQueryPage';
import SecurityGroupPage from './pages/SecurityGroupPage';
import SiteMonitorPage from './pages/SiteMonitorPage';
import EnvironmentManagementPage from './pages/EnvironmentManagementPage';
import S3UploadPage from './pages/S3UploadPage';
import AccountManagementPage from './pages/AccountManagementPage';
import LineOnboardingPage from './pages/LineOnboardingPage';
import LineListPage from './pages/LineListPage';
import ForbiddenPage from './pages/ForbiddenPage';
import LoginPage from './pages/LoginPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import AiOpsPage from './pages/AiOpsPage';
import { EnvironmentContext, EnvironmentProvider } from './contexts/EnvironmentContext';
import { AuthContext, AuthProvider } from './contexts/AuthContext';
import './App.css';
import Home from './pages/Home';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const EnvironmentSwitcher: React.FC = () => {
  const { environments, currentEnvironment, setCurrentEnvironment, loading, error } = useContext(EnvironmentContext);

  if (loading) return <Spin size="small" />;
  if (error) return <Alert message="无法加载环境" type="error" showIcon />;

  return (
    <Select
      value={currentEnvironment?.id}
      onChange={(value) => setCurrentEnvironment(environments.find(e => e.id === value)!)}
      options={environments.map(env => ({ label: env.name, value: env.id }))}
      showSearch
      filterOption={(input, option) =>
        ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
      }
      style={{ width: 240, marginRight: 24 }}
    />
  );
};

const ProtectedRoute: React.FC<{ required?: string[]; requiredAny?: string[]; children: React.ReactNode }> = ({ required = [], requiredAny = [], children }) => {
  const { permissions, loading, isAuthenticated } = useContext(AuthContext);

  if (loading) {
    return <Spin />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allRequiredAllowed = required.length === 0 || required.every((key) => permissions.includes(key));
  const anyRequiredAllowed = requiredAny.length === 0 || requiredAny.some((key) => permissions.includes(key));
  if (!allRequiredAllowed || !anyRequiredAllowed) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
};

const AppLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, permissions, loading: authLoading, error: authError, isAuthenticated, logout } = useContext(AuthContext);

  const hasPermission = (key?: string | string[]) => {
    if (!key) return true;
    if (Array.isArray(key)) {
      return key.some((k) => permissions.includes(k));
    }
    return permissions.includes(key);
  };

  const menuItems = [
    { key: '/s3-upload', label: 'S3 上传', icon: <CloudUploadOutlined />, permission: 'menu:s3-upload' },
    { key: '/deployments', label: 'EKS 部署', icon: <DeploymentUnitOutlined />, permission: 'menu:deployments' },
    { key: '/jump-servers', label: 'Windows跳板机', icon: <DeploymentUnitOutlined />, permission: 'menu:jump-servers' },
    { key: '/data-query', label: '查询中心', icon: <DeploymentUnitOutlined />, permission: 'menu:data-query' },
    { key: '/security-groups', label: '安全组管理', icon: <SafetyCertificateOutlined />, permission: 'menu:security-groups' },
    { key: '/lines', label: '线路总览', icon: <GlobalOutlined />, permission: ['menu:line-onboarding', 'menu:lines'] },
    { key: '/line-onboarding', label: '新增线路', icon: <GlobalOutlined />, permission: ['menu:line-onboarding', 'menu:lines'] },
    { key: '/site-monitors', label: '站点监控', icon: <AimOutlined />, permission: 'menu:site-monitors' },
    { key: '/ai-ops', label: 'AI 运维', icon: <RobotOutlined />, permission: 'menu:ai-ops' },
    { key: '/environments', label: '环境管理', icon: <SettingOutlined />, permission: 'menu:environments' },
    { key: '/access-control', label: '账号管理', icon: <TeamOutlined />, permission: 'menu:access-control' },
  ];

  const visibleMenuItems = authLoading
    ? menuItems
    : menuItems.filter((item) => hasPermission(item.permission));

  if (!authLoading && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const identityLabel =
    me?.identity?.display_name ||
    me?.identity?.email ||
    me?.username ||
    'Unknown';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div className="logo">运维平台</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
        >
          {visibleMenuItems.map((item) => (
            <Menu.Item key={item.key} icon={item.icon} disabled={authLoading}>
              <Link to={item.key}>{item.label}</Link>
            </Menu.Item>
          ))}
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
            justifyContent: 'space-between',
          }}
        >
          <EnvironmentSwitcher />
          <Space size={12}>
            <Text type="secondary">{identityLabel}</Text>
            <Button onClick={handleLogout}>退出登录</Button>
          </Space>
        </Header>
        <Content style={{ margin: '24px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 24, background: '#fff', borderRadius: '8px', flex: 1}}>
            {authError && <Alert type="error" message={authError} showIcon style={{ marginBottom: 16 }} />}
            <Routes>
              <Route path="/deployments" element={<ProtectedRoute required={['menu:deployments']}><DeploymentListPage /></ProtectedRoute>} />
              <Route path="/jump-servers" element={<ProtectedRoute required={['menu:jump-servers']}><WindowsJumpServerPage /></ProtectedRoute>} />
              <Route path="/data-query" element={<ProtectedRoute required={['menu:data-query']}><DataQueryPage /></ProtectedRoute>} />
              <Route path="/security-groups" element={<ProtectedRoute required={['menu:security-groups']}><SecurityGroupPage /></ProtectedRoute>} />
              <Route
                path="/lines"
                element={
                  <ProtectedRoute requiredAny={['menu:line-onboarding', 'menu:lines']}>
                    <LineListPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/line-onboarding" element={<ProtectedRoute requiredAny={['menu:line-onboarding', 'menu:lines']}><LineOnboardingPage /></ProtectedRoute>} />
              <Route path="/site-monitors" element={<ProtectedRoute required={['menu:site-monitors']}><SiteMonitorPage /></ProtectedRoute>} />
              <Route path="/environments" element={<ProtectedRoute required={['menu:environments']}><EnvironmentManagementPage /></ProtectedRoute>} />
              <Route path="/s3-upload" element={<ProtectedRoute required={['menu:s3-upload']}><S3UploadPage /></ProtectedRoute>} />
              <Route path="/access-control" element={<ProtectedRoute required={['menu:access-control']}><AccountManagementPage /></ProtectedRoute>} />
              <Route path="/ai-ops" element={<ProtectedRoute required={['menu:ai-ops']}><AiOpsPage /></ProtectedRoute>} />
              <Route path="/403" element={<ForbiddenPage />} />
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
  <AuthProvider>
    <EnvironmentProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso/callback" element={<SsoCallbackPage />} />
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </EnvironmentProvider>
  </AuthProvider>
);

export default App;
