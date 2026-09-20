import React, { useContext } from 'react';
import { Layout, Menu, Select, Spin, Alert, Space, Button, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Link, Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { FileProtectOutlined, DeploymentUnitOutlined, SafetyCertificateOutlined, GlobalOutlined, AimOutlined, SettingOutlined, CloudUploadOutlined, RobotOutlined, LineChartOutlined, BookOutlined, DatabaseOutlined } from '@ant-design/icons';
import DeploymentListPage from './pages/DeploymentListPage';
import WindowsJumpServerPage from './pages/WindowsJumpServerPage';
import DataQueryPage from './pages/DataQueryPage';
import SecurityGroupPage from './pages/SecurityGroupPage';
import SiteMonitorPage from './pages/SiteMonitorPage';
import EnvironmentManagementPage from './pages/EnvironmentManagementPage';
import S3UploadPage from './pages/S3UploadPage';
import AccountManagementPage from './pages/AccountManagementPage';
import AuditLogPage from './pages/AuditLogPage';
import LineOnboardingPage from './pages/LineOnboardingPage';
import LineListPage from './pages/LineListPage';
import ForbiddenPage from './pages/ForbiddenPage';
import LoginPage from './pages/LoginPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import AiOpsPage from './pages/AiOpsPage';
import SignalMonitorRealtimePage from './pages/SignalMonitorRealtimePage';
import SignalMonitorHistoryPage from './pages/SignalMonitorHistoryPage';
import SignalMonitorStatsPage from './pages/SignalMonitorStatsPage';
import SignalMonitorDailyPage from './pages/SignalMonitorDailyPage';
import CertStudyPage from './pages/CertStudyPage';
import AssetManagementPage from './pages/AssetManagementPage';
import SiteConfPage from './pages/SiteConfPage';
import SslCertificateExportPage from './pages/SslCertificateExportPage';
import MonitoringRequestsPage from './pages/MonitoringRequestsPage';
import KmsValuesPage from './pages/KmsValuesPage';
import { EnvironmentContext, EnvironmentProvider } from './contexts/EnvironmentContext';
import { AuthContext, AuthProvider } from './contexts/AuthContext';
import './App.css';
import Home from './pages/Home';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const EnvironmentSwitcher: React.FC = () => {
  const { environments, currentEnvironment, setCurrentEnvironment, refreshEnvironments, loading, error } = useContext(EnvironmentContext);

  if (loading) return <Spin size="small" />;
  if (error) {
    return (
      <Space size={8} style={{ marginRight: 24 }}>
        <Alert message="无法加载环境" type="error" showIcon />
        <Button size="small" loading={loading} onClick={() => refreshEnvironments()}>重试</Button>
      </Space>
    );
  }

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

  const menuItems = {
    s3Upload: { key: '/s3-upload', label: 'S3 上传', icon: <CloudUploadOutlined />, permission: 'menu:s3-upload' },
    deployments: { key: '/deployments', label: 'EKS 部署', icon: <DeploymentUnitOutlined />, permission: 'menu:deployments' },
    jumpServers: { key: '/jump-servers', label: 'Windows跳板机', icon: <DeploymentUnitOutlined />, permission: 'menu:jump-servers' },
    dataQuery: { key: '/data-query', label: '查询中心', icon: <DeploymentUnitOutlined />, permission: 'menu:data-query' },
    securityGroups: { key: '/security-groups', label: '安全组管理', icon: <SafetyCertificateOutlined />, permission: 'menu:security-groups' },
    lines: { key: '/lines', label: '线路总览', icon: <GlobalOutlined />, permission: 'menu:lines' },
    lineOnboarding: { key: '/line-onboarding', label: '新增线路', icon: <GlobalOutlined />, permission: 'menu:line-onboarding' },
    siteMonitors: { key: '/site-monitors', label: '站点监控', icon: <AimOutlined />, permission: 'menu:site-monitors' },
    monitoringRequests: { key: '/monitoring-requests', label: '监控资源申请', icon: <FileProtectOutlined />, permission: 'menu:monitoring-requests' },
    aiOps: { key: '/ai-ops', label: 'AI 运维', icon: <RobotOutlined />, permission: 'menu:ai-ops' },
    sslCertificates: { key: '/ssl-certificates', label: 'SSL证书申请', icon: <SafetyCertificateOutlined />, permission: 'menu:ssl-certificates' },
    kmsValues: { key: '/kms-values', label: 'KMS 配置加解密', icon: <SafetyCertificateOutlined />, permission: 'menu:kms-values' },
    environments: { key: '/environments', label: '环境管理', icon: <SettingOutlined />, permission: 'menu:environments' },
    siteConf: { key: '/site-conf', label: 'siteconf 配置', icon: <SettingOutlined />, permission: 'menu:site-conf' },
  };

  const createMenuLink = (item: { key: string; label: string }) => <Link to={item.key}>{item.label}</Link>;

  const createMenuGroup = (
    key: string,
    label: string,
    icon: React.ReactNode,
    items: Array<{ key: string; label: string; icon: React.ReactNode; permission: string }>,
  ): NonNullable<MenuProps['items']>[number] | null => {
    const visibleItems = authLoading ? items : items.filter((item) => hasPermission(item.permission));
    if (!authLoading && visibleItems.length === 0) return null;
    return {
      key,
      label,
      icon,
      children: visibleItems.map((item) => ({
        key: item.key,
        label: createMenuLink(item),
        disabled: authLoading,
      })),
    };
  };

  const accessControlPermission = 'menu:access-control';

  const accessControlGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/access-control',
    label: '账号管理',
    children: [
      { key: '/access-control/users', label: <Link to="/access-control/users">账号与权限</Link> },
      { key: '/access-control/audit-logs', label: <Link to="/access-control/audit-logs">审计日志</Link> },
    ],
  };

  const signalMonitorPermission = 'menu:signal-monitor';

  const signalMonitorGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/signal-monitor',
    label: 'Signal Monitor',
    icon: <LineChartOutlined />,
    children: [
      { key: '/signal-monitor/realtime', label: <Link to="/signal-monitor/realtime">实时</Link> },
      { key: '/signal-monitor/history', label: <Link to="/signal-monitor/history">触发记录</Link> },
      { key: '/signal-monitor/stats', label: <Link to="/signal-monitor/stats">统计</Link> },
      { key: '/signal-monitor/daily', label: <Link to="/signal-monitor/daily">日报</Link> },
    ],
  };

  const certStudyPermission = 'menu:cert-study';
  const certStudyGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/cert-study',
    label: '证书题库',
    icon: <BookOutlined />,
    children: [
      { key: '/cert-study/sap-c02', label: <Link to="/cert-study/sap-c02">SAP-C02</Link> },
      { key: '/cert-study/dop-c02', label: <Link to="/cert-study/dop-c02">DOP-C02</Link> },
      { key: '/cert-study/scs-c03', label: <Link to="/cert-study/scs-c03">SCS-C03</Link> },
    ],
  };


  const assetManagementPermission = 'menu:asset-management';
  const assetManagementGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/asset-management',
    label: '资产管理',
    icon: <DatabaseOutlined />,
    children: [
      { key: '/asset-management/overview', label: <Link to="/asset-management/overview">资产总览</Link> },
      { key: '/asset-management/accounts', label: <Link to="/asset-management/accounts">账号管理</Link> },
      { key: '/asset-management/resources', label: <Link to="/asset-management/resources">服务资源</Link> },
      { key: '/asset-management/domains', label: <Link to="/asset-management/domains">域名管理</Link> },
      { key: '/asset-management/credential-refs', label: <Link to="/asset-management/credential-refs">凭证索引</Link> },
      { key: '/asset-management/change-logs', label: <Link to="/asset-management/change-logs">变更记录</Link> },
    ],
  };

  const cloudResourceGroup = createMenuGroup(
    '/cloud-resources',
    '云资源',
    <DeploymentUnitOutlined />,
    [menuItems.deployments, menuItems.jumpServers, menuItems.securityGroups, menuItems.s3Upload],
  );

  const lineManagementGroup = createMenuGroup(
    '/line-management',
    '线路管理',
    <GlobalOutlined />,
    [menuItems.lines, menuItems.lineOnboarding],
  );

  const monitoringGroup = createMenuGroup(
    '/monitoring',
    '监控与告警',
    <AimOutlined />,
    [menuItems.siteMonitors, menuItems.monitoringRequests],
  );

  const opsToolsGroup = createMenuGroup(
    '/ops-tools',
    '运维工具',
    <RobotOutlined />,
    [menuItems.dataQuery, menuItems.aiOps, menuItems.sslCertificates, menuItems.kmsValues],
  );

  const systemManagementChildren: NonNullable<MenuProps['items']> = [
    ...((authLoading || hasPermission(menuItems.environments.permission))
      ? [{
          key: menuItems.environments.key,
          label: createMenuLink(menuItems.environments),
          disabled: authLoading,
        }]
      : []),
    ...((authLoading || hasPermission(menuItems.siteConf.permission))
      ? [{
          key: menuItems.siteConf.key,
          label: createMenuLink(menuItems.siteConf),
          disabled: authLoading,
        }]
      : []),
    ...((authLoading || hasPermission(accessControlPermission)) ? [accessControlGroup] : []),
  ];

  const systemManagementGroup: NonNullable<MenuProps['items']>[number] | null =
    !authLoading && systemManagementChildren.length === 0
      ? null
      : {
          key: '/system-management',
          label: '系统管理',
          icon: <SettingOutlined />,
          children: systemManagementChildren,
        };

  const visibleMenuItems: MenuProps['items'] = [
    cloudResourceGroup,
    ...((authLoading || hasPermission(assetManagementPermission)) ? [assetManagementGroup] : []),
    lineManagementGroup,
    monitoringGroup,
    opsToolsGroup,
    ...((authLoading || hasPermission(certStudyPermission)) ? [certStudyGroup] : []),
    systemManagementGroup,
    ...((authLoading || hasPermission(signalMonitorPermission)) ? [signalMonitorGroup] : []),
  ].filter(Boolean) as MenuProps['items'];

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

  const selectedKey = location.pathname;
  const openKeys = [
    ...(['/deployments', '/jump-servers', '/security-groups', '/s3-upload'].some((path) => location.pathname.startsWith(path)) ? ['/cloud-resources'] : []),
    ...(location.pathname.startsWith('/asset-management') ? ['/asset-management'] : []),
    ...(['/lines', '/line-onboarding'].some((path) => location.pathname.startsWith(path)) ? ['/line-management'] : []),
    ...(['/site-monitors', '/monitoring-requests'].some((path) => location.pathname.startsWith(path)) ? ['/monitoring'] : []),
    ...(['/data-query', '/ai-ops'].some((path) => location.pathname.startsWith(path)) ? ['/ops-tools'] : []),
    ...(location.pathname.startsWith('/cert-study/') ? ['/cert-study'] : []),
    ...(['/environments', '/site-conf', '/access-control'].some((path) => location.pathname.startsWith(path)) ? ['/system-management'] : []),
    ...(location.pathname.startsWith('/access-control') ? ['/access-control'] : []),
    ...(location.pathname.startsWith('/signal-monitor/') ? ['/signal-monitor'] : []),
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div className="logo">运维支持系统</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKeys}
          items={visibleMenuItems}
        />
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
              <Route path="/asset-management" element={<Navigate to="/asset-management/overview" replace />} />
              <Route path="/asset-management/overview" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="overview" /></ProtectedRoute>} />
              <Route path="/asset-management/accounts" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="accounts" /></ProtectedRoute>} />
              <Route path="/asset-management/resources" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="resources" /></ProtectedRoute>} />
              <Route path="/asset-management/domains" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="domains" /></ProtectedRoute>} />
              <Route path="/asset-management/credential-refs" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="credential-refs" /></ProtectedRoute>} />
              <Route path="/asset-management/cdn-sync" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="cdn-sync" /></ProtectedRoute>} />
              <Route path="/asset-management/change-logs" element={<ProtectedRoute required={[assetManagementPermission]}><AssetManagementPage activeTab="change-logs" /></ProtectedRoute>} />
              <Route path="/lines" element={<ProtectedRoute required={['menu:lines']}><LineListPage /></ProtectedRoute>} />
              <Route path="/line-onboarding" element={<ProtectedRoute required={['menu:line-onboarding']}><LineOnboardingPage /></ProtectedRoute>} />
              <Route path="/site-monitors" element={<ProtectedRoute required={['menu:site-monitors']}><SiteMonitorPage /></ProtectedRoute>} />
              <Route path="/monitoring-requests" element={<ProtectedRoute required={['menu:monitoring-requests']}><MonitoringRequestsPage /></ProtectedRoute>} />
              <Route path="/environments" element={<ProtectedRoute required={['menu:environments']}><EnvironmentManagementPage /></ProtectedRoute>} />
              <Route path="/site-conf" element={<ProtectedRoute required={['menu:site-conf']}><SiteConfPage /></ProtectedRoute>} />
              <Route path="/s3-upload" element={<ProtectedRoute required={['menu:s3-upload']}><S3UploadPage /></ProtectedRoute>} />
              <Route path="/access-control" element={<Navigate to="/access-control/users" replace />} />
              <Route path="/access-control/users" element={<ProtectedRoute required={[accessControlPermission]}><AccountManagementPage /></ProtectedRoute>} />
              <Route path="/access-control/audit-logs" element={<ProtectedRoute required={[accessControlPermission]}><AuditLogPage /></ProtectedRoute>} />
              <Route path="/ai-ops" element={<ProtectedRoute required={['menu:ai-ops']}><AiOpsPage /></ProtectedRoute>} />
              <Route path="/ssl-certificates" element={<ProtectedRoute required={['menu:ssl-certificates']}><SslCertificateExportPage /></ProtectedRoute>} />
              <Route path="/kms-values" element={<ProtectedRoute required={['menu:kms-values']}><KmsValuesPage /></ProtectedRoute>} />
              <Route path="/cert-study" element={<Navigate to="/cert-study/sap-c02" replace />} />
              <Route
                path="/cert-study/sap-c02"
                element={<ProtectedRoute required={[certStudyPermission]}><CertStudyPage examCode="SAP-C02" examTitle="SAP-C02" /></ProtectedRoute>}
              />
              <Route
                path="/cert-study/dop-c02"
                element={<ProtectedRoute required={[certStudyPermission]}><CertStudyPage examCode="DOP-C02" examTitle="DOP-C02" /></ProtectedRoute>}
              />
              <Route
                path="/cert-study/scs-c03"
                element={<ProtectedRoute required={[certStudyPermission]}><CertStudyPage examCode="SCS-C03" examTitle="SCS-C03" /></ProtectedRoute>}
              />
              <Route path="/signal-monitor/realtime" element={<ProtectedRoute required={[signalMonitorPermission]}><SignalMonitorRealtimePage /></ProtectedRoute>} />
              <Route path="/signal-monitor/history" element={<ProtectedRoute required={[signalMonitorPermission]}><SignalMonitorHistoryPage /></ProtectedRoute>} />
              <Route path="/signal-monitor/stats" element={<ProtectedRoute required={[signalMonitorPermission]}><SignalMonitorStatsPage /></ProtectedRoute>} />
              <Route path="/signal-monitor/daily" element={<ProtectedRoute required={[signalMonitorPermission]}><SignalMonitorDailyPage /></ProtectedRoute>} />
              <Route path="/403" element={<ForbiddenPage />} />
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
