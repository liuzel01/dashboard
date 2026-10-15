import React, { lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Select, Spin, Alert, Space, Button } from 'antd';
import type { MenuProps } from 'antd';
import { Link, Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { FileProtectOutlined, DeploymentUnitOutlined, SafetyCertificateOutlined, GlobalOutlined, AimOutlined, SettingOutlined, CloudUploadOutlined, RobotOutlined, LineChartOutlined, BookOutlined, DatabaseOutlined, AlertOutlined, RocketOutlined } from '@ant-design/icons';
import { EnvironmentProvider } from './contexts/EnvironmentContext';
import { EnvironmentContext } from './contexts/EnvironmentContextValue';
import { AuthProvider } from './contexts/AuthContext';
import { AuthContext } from './contexts/AuthContextValue';
import './App.css';
import AppShell from './components/AppShell';
import { DesktopNotificationPrompt } from './components/DesktopNotificationPrompt';
import { CicdRealtimeProvider } from './contexts/CicdRealtimeContext';
import { BytebaseRealtimeProvider } from './contexts/BytebaseRealtimeContext';
import { getMenuOrder, type MenuOrderMap } from './services/api';
import { readCachedMenuOrder, writeCachedMenuOrder } from './utils/menuOrderCache';

const DeploymentListPage = lazy(() => import('./pages/DeploymentListPage'));
const WindowsJumpServerPage = lazy(() => import('./pages/WindowsJumpServerPage'));
const DataQueryPage = lazy(() => import('./pages/DataQueryPage'));
const SecurityGroupPage = lazy(() => import('./pages/SecurityGroupPage'));
const SiteMonitorPage = lazy(() => import('./pages/SiteMonitorPage'));
const EnvironmentManagementPage = lazy(() => import('./pages/EnvironmentManagementPage'));
const S3UploadPage = lazy(() => import('./pages/S3UploadPage'));
const AccountManagementPage = lazy(() => import('./pages/AccountManagementPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const LineOnboardingPage = lazy(() => import('./pages/LineOnboardingPage'));
const AdminSiteIngressPage = lazy(() => import('./pages/AdminSiteIngressPage'));
const LineListPage = lazy(() => import('./pages/LineListPage'));
const ForbiddenPage = lazy(() => import('./pages/ForbiddenPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SsoCallbackPage = lazy(() => import('./pages/SsoCallbackPage'));
const AiOpsPage = lazy(() => import('./pages/AiOpsPage'));
const AiOpsWorkbenchPage = lazy(() => import('./pages/AiOpsWorkbenchPage'));
const AiOpsInvestigationDetailPage = lazy(() => import('./pages/AiOpsInvestigationDetailPage'));
const SignalMonitorRealtimePage = lazy(() => import('./pages/SignalMonitorRealtimePage'));
const SignalMonitorHistoryPage = lazy(() => import('./pages/SignalMonitorHistoryPage'));
const SignalMonitorStatsPage = lazy(() => import('./pages/SignalMonitorStatsPage'));
const SignalMonitorDailyPage = lazy(() => import('./pages/SignalMonitorDailyPage'));
const CertStudyPage = lazy(() => import('./pages/CertStudyPage'));
const AssetManagementPage = lazy(() => import('./pages/AssetManagementPage'));
const SiteConfPage = lazy(() => import('./pages/SiteConfPage'));
const SslCertificateExportPage = lazy(() => import('./pages/SslCertificateExportPage'));
const MonitoringRequestsPage = lazy(() => import('./pages/MonitoringRequestsPage'));
const KmsValuesPage = lazy(() => import('./pages/KmsValuesPage'));
const OncallPage = lazy(() => import('./pages/OncallPage'));
const CicdCatalogPage = lazy(() => import('./pages/CicdCatalogPage'));
const MenuOrderManagementPage = lazy(() => import('./pages/MenuOrderManagementPage'));
const DependencyHealthPage = lazy(() => import('./pages/DependencyHealthPage'));
const BytebaseCenterPage = lazy(() => import('./pages/BytebaseCenterPage'));
const Home = lazy(() => import('./pages/Home'));

const PageLoadingFallback: React.FC = () => (
  <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }} aria-label="页面加载中">
    <Spin size="large" />
  </div>
);

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
  const [siderCollapsed, setSiderCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('dashboard.sider.collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [menuOrderGroups, setMenuOrderGroups] = useState<MenuOrderMap>(() => readCachedMenuOrder() || {});
  const [menuOrderLoaded, setMenuOrderLoaded] = useState(() => Boolean(readCachedMenuOrder()));

  useEffect(() => {
    if (!isAuthenticated) {
      setMenuOrderGroups({});
      setMenuOrderLoaded(false);
      return;
    }
    let active = true;
    const cached = readCachedMenuOrder();
    if (cached) {
      setMenuOrderGroups(cached);
      setMenuOrderLoaded(true);
    }
    void getMenuOrder()
      .then((data) => {
        const groups = data.groups || {};
        writeCachedMenuOrder(groups);
        if (active) setMenuOrderGroups(groups);
      })
      .catch(() => { if (active) setMenuOrderGroups({}); })
      .finally(() => { if (active) setMenuOrderLoaded(true); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const handleSiderCollapse = (collapsed: boolean) => {
    setSiderCollapsed(collapsed);
    try {
      window.localStorage.setItem('dashboard.sider.collapsed', String(collapsed));
    } catch {
      // Ignore unavailable localStorage (for example, private browsing restrictions).
    }
  };

  const hasPermission = (key?: string | string[]) => {
    if (!key) return true;
    if (Array.isArray(key)) {
      return key.some((k) => permissions.includes(k));
    }
    return permissions.includes(key);
  };

  // Keep second-level navigation ordered by operational workflow, not creation
  // time or translated labels. Leave gaps so new entries can be placed without
  // renumbering the whole group.
  const menuItems = {
    deployments: { key: '/deployments', label: 'EKS 部署', icon: <DeploymentUnitOutlined />, permission: 'menu:deployments', order: 10 },
    jumpServers: { key: '/jump-servers', label: 'Windows跳板机', icon: <DeploymentUnitOutlined />, permission: 'menu:jump-servers', order: 20 },
    securityGroups: { key: '/security-groups', label: '安全组管理', icon: <SafetyCertificateOutlined />, permission: 'menu:security-groups', order: 30 },
    s3Upload: { key: '/s3-upload', label: 'S3 上传', icon: <CloudUploadOutlined />, permission: 'menu:s3-upload', order: 40 },
    lines: { key: '/lines', label: '线路总览', icon: <GlobalOutlined />, permission: 'menu:lines', order: 10 },
    lineOnboarding: { key: '/line-onboarding', label: '新增线路', icon: <GlobalOutlined />, permission: 'menu:line-onboarding', order: 20 },
    adminSiteOnboarding: { key: '/admin-site-ingress', label: '管理端网站 Ingress', icon: <GlobalOutlined />, permission: 'menu:admin-site-onboarding', order: 30 },
    siteMonitors: { key: '/site-monitors', label: '站点监控', icon: <AimOutlined />, permission: 'menu:site-monitors', order: 10 },
    dependencyHealth: { key: '/dependency-health', label: '外部依赖健康', icon: <AimOutlined />, permission: 'menu:dependency-health', order: 15 },
    monitoringRequests: { key: '/monitoring-requests', label: '监控资源申请', icon: <FileProtectOutlined />, permission: 'menu:monitoring-requests', order: 20 },
    oncall: { key: '/oncall', label: 'Oncall 告警', icon: <AlertOutlined />, permission: 'menu:oncall', order: 30 },
    dataQuery: { key: '/data-query', label: '查询中心', icon: <DeploymentUnitOutlined />, permission: 'menu:data-query', order: 10 },
    cicdRuns: { key: '/cicd-runs', label: 'CI/CD 执行中心', icon: <RocketOutlined />, permission: 'menu:cicd-runs', order: 20 },
    bytebase: { key: '/bytebase', label: '数据库访问与变更', icon: <DatabaseOutlined />, permission: 'menu:bytebase', order: 25 },
    sslCertificates: { key: '/ssl-certificates', label: 'SSL证书申请', icon: <SafetyCertificateOutlined />, permission: 'menu:ssl-certificates', order: 30 },
    kmsValues: { key: '/kms-values', label: 'KMS 配置加解密', icon: <SafetyCertificateOutlined />, permission: 'menu:kms-values', order: 40 },
    aiOps: { key: '/ai-ops', label: 'AI 运维', icon: <RobotOutlined />, permission: 'menu:ai-ops', order: 50 },
    environments: { key: '/environments', label: '环境管理', icon: <SettingOutlined />, permission: 'menu:environments', order: 20 },
    siteConf: { key: '/site-conf', label: 'siteconf 配置', icon: <SettingOutlined />, permission: 'menu:site-conf', order: 30 },
    menuManagement: { key: '/menu-management', label: '菜单排序管理', icon: <SettingOutlined />, permission: 'menu:menu-management', order: 40 },
  };

  const createMenuLink = (item: { key: string; label: string }) => <Link to={item.key}>{item.label}</Link>;

  const sortByMenuOrder = <T extends { key: string; order: number }>(groupKey: string, items: T[]) => {
    const configured = menuOrderGroups[groupKey] || [];
    const positions = new Map(configured.map((key, index) => [key, index]));
    return [...items].sort((left, right) => {
      const leftPosition = positions.get(left.key);
      const rightPosition = positions.get(right.key);
      if (leftPosition !== undefined || rightPosition !== undefined) {
        if (leftPosition === undefined) return 1;
        if (rightPosition === undefined) return -1;
        if (leftPosition !== rightPosition) return leftPosition - rightPosition;
      }
      return left.order - right.order || left.key.localeCompare(right.key);
    });
  };

  const createOrderedChildren = <T extends { key: string; order: number }>(groupKey: string, items: T[]) =>
    sortByMenuOrder(groupKey, items).map(({ order: _order, ...item }) => item);

  const createMenuGroup = (
    key: string,
    label: string,
    icon: React.ReactNode,
    items: Array<{ key: string; label: string; icon: React.ReactNode; permission: string; order: number }>,
  ): NonNullable<MenuProps['items']>[number] | null => {
    const visibleItems = sortByMenuOrder(key, items.filter((item) => hasPermission(item.permission)));
    if (visibleItems.length === 0) return null;
    return {
      key,
      label,
      icon,
      children: visibleItems.map((item) => ({
        key: item.key,
        label: createMenuLink(item),
      })),
    };
  };

  const accessControlPermission = 'menu:access-control';

  const accessControlGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/access-control',
    label: '账号管理',
    children: createOrderedChildren('/access-control', [
      { key: '/access-control/users', label: <Link to="/access-control/users">账号与权限</Link>, order: 10 },
      { key: '/access-control/audit-logs', label: <Link to="/access-control/audit-logs">审计日志</Link>, order: 20 },
    ]),
  };

  const signalMonitorPermission = 'menu:signal-monitor';

  const signalMonitorGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/signal-monitor',
    label: 'Signal Monitor',
    icon: <LineChartOutlined />,
    children: createOrderedChildren('/signal-monitor', [
      { key: '/signal-monitor/realtime', label: <Link to="/signal-monitor/realtime">实时</Link>, order: 10 },
      { key: '/signal-monitor/history', label: <Link to="/signal-monitor/history">触发记录</Link>, order: 20 },
      { key: '/signal-monitor/stats', label: <Link to="/signal-monitor/stats">统计</Link>, order: 30 },
      { key: '/signal-monitor/daily', label: <Link to="/signal-monitor/daily">日报</Link>, order: 40 },
    ]),
  };

  const certStudyPermission = 'menu:cert-study';
  const certStudyGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/cert-study',
    label: '证书题库',
    icon: <BookOutlined />,
    children: createOrderedChildren('/cert-study', [
      { key: '/cert-study/sap-c02', label: <Link to="/cert-study/sap-c02">SAP-C02</Link>, order: 10 },
      { key: '/cert-study/dop-c02', label: <Link to="/cert-study/dop-c02">DOP-C02</Link>, order: 20 },
      { key: '/cert-study/scs-c03', label: <Link to="/cert-study/scs-c03">SCS-C03</Link>, order: 30 },
    ]),
  };


  const assetManagementPermission = 'menu:asset-management';
  const assetManagementGroup: NonNullable<MenuProps['items']>[number] = {
    key: '/asset-management',
    label: '资产管理',
    icon: <DatabaseOutlined />,
    children: createOrderedChildren('/asset-management', [
      { key: '/asset-management/overview', label: <Link to="/asset-management/overview">资产总览</Link>, order: 10 },
      { key: '/asset-management/resources', label: <Link to="/asset-management/resources">服务资源</Link>, order: 20 },
      { key: '/asset-management/domains', label: <Link to="/asset-management/domains">域名管理</Link>, order: 30 },
      { key: '/asset-management/accounts', label: <Link to="/asset-management/accounts">账号管理</Link>, order: 40 },
      { key: '/asset-management/credential-refs', label: <Link to="/asset-management/credential-refs">凭证索引</Link>, order: 50 },
      { key: '/asset-management/change-logs', label: <Link to="/asset-management/change-logs">变更记录</Link>, order: 60 },
    ]),
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
    [menuItems.lines, menuItems.lineOnboarding, menuItems.adminSiteOnboarding],
  );

  const monitoringGroup = createMenuGroup(
    '/monitoring',
    '监控与告警',
    <AimOutlined />,
    [menuItems.siteMonitors, menuItems.dependencyHealth, menuItems.monitoringRequests, menuItems.oncall],
  );

  const opsToolsGroup = createMenuGroup(
    '/ops-tools',
    '运维工具',
    <RobotOutlined />,
    [menuItems.dataQuery, menuItems.bytebase, menuItems.aiOps, menuItems.sslCertificates, menuItems.kmsValues, menuItems.cicdRuns],
  );

  const systemManagementChildren: NonNullable<MenuProps['items']> = createOrderedChildren('/system-management', [
    ...(hasPermission(accessControlPermission) ? [{ ...accessControlGroup, order: 10 }] : []),
    ...(hasPermission(menuItems.environments.permission)
      ? [{
          key: menuItems.environments.key,
          label: createMenuLink(menuItems.environments),
          order: menuItems.environments.order,
        }]
      : []),
    ...(hasPermission(menuItems.siteConf.permission)
      ? [{
          key: menuItems.siteConf.key,
          label: createMenuLink(menuItems.siteConf),
          order: menuItems.siteConf.order,
        }]
      : []),
    ...(hasPermission(menuItems.menuManagement.permission)
      ? [{
          key: menuItems.menuManagement.key,
          label: createMenuLink(menuItems.menuManagement),
          order: menuItems.menuManagement.order,
        }]
      : []),
  ]);

  const systemManagementGroup: NonNullable<MenuProps['items']>[number] | null =
    systemManagementChildren.length === 0
      ? null
      : {
          key: '/system-management',
          label: '系统管理',
          icon: <SettingOutlined />,
          children: systemManagementChildren,
        };

  const visibleMenuItems: MenuProps['items'] = [
    cloudResourceGroup,
    ...(hasPermission(assetManagementPermission) ? [assetManagementGroup] : []),
    lineManagementGroup,
    monitoringGroup,
    opsToolsGroup,
    ...(hasPermission(certStudyPermission) ? [certStudyGroup] : []),
    systemManagementGroup,
    ...(hasPermission(signalMonitorPermission) ? [signalMonitorGroup] : []),
  ].filter(Boolean) as MenuProps['items'];

  if (authLoading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>;
  }

  if (!isAuthenticated) {
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
    ...(['/lines', '/line-onboarding', '/admin-site-ingress'].some((path) => location.pathname.startsWith(path)) ? ['/line-management'] : []),
    ...(['/site-monitors', '/monitoring-requests', '/oncall'].some((path) => location.pathname.startsWith(path)) ? ['/monitoring'] : []),
    ...(['/data-query', '/bytebase', '/ai-ops', '/ssl-certificates', '/kms-values', '/cicd-runs'].some((path) => location.pathname.startsWith(path)) ? ['/ops-tools'] : []),
    ...(location.pathname.startsWith('/cert-study/') ? ['/cert-study'] : []),
    ...(['/environments', '/site-conf', '/access-control', '/menu-management'].some((path) => location.pathname.startsWith(path)) ? ['/system-management'] : []),
    ...(location.pathname.startsWith('/access-control') ? ['/access-control'] : []),
    ...(location.pathname.startsWith('/signal-monitor/') ? ['/signal-monitor'] : []),
  ];

  return (
    <CicdRealtimeProvider>
      <BytebaseRealtimeProvider>
      <AppShell
      collapsed={siderCollapsed}
      onCollapsedChange={handleSiderCollapse}
      menuItems={visibleMenuItems}
      navigationLoading={!menuOrderLoaded}
      selectedKey={selectedKey}
      defaultOpenKeys={openKeys}
      headerStart={<EnvironmentSwitcher />}
      identityLabel={identityLabel}
      onLogout={handleLogout}
      authError={authError}
    >
      <DesktopNotificationPrompt
        userKey={String(me?.id || me?.username || 'unknown')}
        visible={permissions.includes('menu:cicd-runs') || permissions.includes('menu:bytebase')}
      />
      <Suspense fallback={<PageLoadingFallback />}>
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
              <Route path="/admin-site-ingress" element={<ProtectedRoute required={['menu:admin-site-onboarding']}><AdminSiteIngressPage /></ProtectedRoute>} />
              <Route path="/site-monitors" element={<ProtectedRoute required={['menu:site-monitors']}><SiteMonitorPage /></ProtectedRoute>} />
              <Route path="/dependency-health" element={<ProtectedRoute required={['menu:dependency-health']}><DependencyHealthPage /></ProtectedRoute>} />
              <Route path="/monitoring-requests" element={<ProtectedRoute required={['menu:monitoring-requests']}><MonitoringRequestsPage /></ProtectedRoute>} />
              <Route path="/oncall" element={<ProtectedRoute required={['menu:oncall']}><OncallPage /></ProtectedRoute>} />
              <Route path="/environments" element={<ProtectedRoute required={['menu:environments']}><EnvironmentManagementPage /></ProtectedRoute>} />
              <Route path="/site-conf" element={<ProtectedRoute required={['menu:site-conf']}><SiteConfPage /></ProtectedRoute>} />
              <Route path="/menu-management" element={<ProtectedRoute required={['menu:menu-management']}><MenuOrderManagementPage /></ProtectedRoute>} />
              <Route path="/s3-upload" element={<ProtectedRoute required={['menu:s3-upload']}><S3UploadPage /></ProtectedRoute>} />
              <Route path="/access-control" element={<Navigate to="/access-control/users" replace />} />
              <Route path="/access-control/users" element={<ProtectedRoute required={[accessControlPermission]}><AccountManagementPage /></ProtectedRoute>} />
              <Route path="/access-control/audit-logs" element={<ProtectedRoute required={[accessControlPermission]}><AuditLogPage /></ProtectedRoute>} />
              <Route path="/ai-ops" element={<ProtectedRoute required={['menu:ai-ops']}><AiOpsWorkbenchPage /></ProtectedRoute>} />
              <Route path="/ai-ops/investigations/:id" element={<ProtectedRoute required={['menu:ai-ops']}><AiOpsInvestigationDetailPage /></ProtectedRoute>} />
              <Route path="/ai-ops/tools/logs" element={<ProtectedRoute required={['menu:ai-ops']}><AiOpsPage mode="logs" /></ProtectedRoute>} />
              <Route path="/ai-ops/tools/sql" element={<ProtectedRoute required={['menu:ai-ops']}><AiOpsPage mode="sql" /></ProtectedRoute>} />
              <Route path="/ssl-certificates" element={<ProtectedRoute required={['menu:ssl-certificates']}><SslCertificateExportPage /></ProtectedRoute>} />
              <Route path="/kms-values" element={<ProtectedRoute required={['menu:kms-values']}><KmsValuesPage /></ProtectedRoute>} />
              <Route path="/cicd-runs" element={<ProtectedRoute required={['menu:cicd-runs']}><CicdCatalogPage /></ProtectedRoute>} />
              <Route path="/bytebase" element={<ProtectedRoute required={['menu:bytebase']}><BytebaseCenterPage /></ProtectedRoute>} />
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
      </Suspense>
      </AppShell>
      </BytebaseRealtimeProvider>
    </CicdRealtimeProvider>
  );
};

const App: React.FC = () => (
  <AuthProvider>
    <EnvironmentProvider>
      <Routes>
        <Route path="/login" element={<Suspense fallback={<PageLoadingFallback />}><LoginPage /></Suspense>} />
        <Route path="/sso/callback" element={<Suspense fallback={<PageLoadingFallback />}><SsoCallbackPage /></Suspense>} />
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </EnvironmentProvider>
  </AuthProvider>
);

export default App;
