import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, List, Modal, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { getMenuOrder, type MenuOrderMap, resetMenuOrder, saveMenuOrder } from '../services/api';
import { PageHeader } from '../components/ops';

const { Text } = Typography;

const GROUPS = [
  { key: '/cloud-resources', label: '云资源' },
  { key: '/asset-management', label: '资产管理' },
  { key: '/line-management', label: '线路管理' },
  { key: '/monitoring', label: '监控与告警' },
  { key: '/ops-tools', label: '运维工具' },
  { key: '/system-management', label: '系统管理' },
  { key: '/cert-study', label: '证书题库' },
  { key: '/signal-monitor', label: 'Signal Monitor' },
];

const LABELS: Record<string, string> = {
  '/deployments': 'EKS 部署', '/jump-servers': 'Windows 跳板机', '/security-groups': '安全组管理', '/s3-upload': 'S3 上传',
  '/asset-management/overview': '资产总览', '/asset-management/resources': '服务资源', '/asset-management/domains': '域名管理', '/asset-management/accounts': '账号管理', '/asset-management/credential-refs': '凭证索引', '/asset-management/change-logs': '变更记录',
  '/lines': '线路总览', '/line-onboarding': '新增线路', '/admin-site-ingress': '管理端网站 Ingress',
  '/site-monitors': '站点监控', '/monitoring-requests': '监控资源申请', '/oncall': 'Oncall 告警',
  '/data-query': '查询中心', '/cicd-runs': 'CI/CD 执行中心', '/ssl-certificates': 'SSL证书申请', '/kms-values': 'KMS 配置加解密', '/ai-ops': 'AI 运维',
  '/access-control': '账号管理', '/environments': '环境管理', '/site-conf': 'siteconf 配置', '/menu-management': '菜单排序管理',
  '/cert-study/sap-c02': 'SAP-C02', '/cert-study/dop-c02': 'DOP-C02', '/cert-study/scs-c03': 'SCS-C03',
  '/signal-monitor/realtime': '实时', '/signal-monitor/history': '触发记录', '/signal-monitor/stats': '统计', '/signal-monitor/daily': '日报',
};

const cloneGroups = (groups: MenuOrderMap): MenuOrderMap =>
  Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, [...values]]));

const MenuOrderManagementPage: React.FC = () => {
  const [groups, setGroups] = useState<MenuOrderMap>({});
  const [savedGroups, setSavedGroups] = useState<MenuOrderMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(true);

  const dirty = useMemo(() => JSON.stringify(groups) !== JSON.stringify(savedGroups), [groups, savedGroups]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getMenuOrder();
      const next = cloneGroups(data.groups || {});
      setGroups(next);
      setSavedGroups(cloneGroups(next));
      setIsDefault(Boolean(data.isDefault));
    } catch (error: any) {
      message.error(error?.message || '加载菜单排序失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const move = (groupKey: string, index: number, offset: number) => {
    setGroups((current) => {
      const next = cloneGroups(current);
      const entries = next[groupKey] || [];
      const target = index + offset;
      if (target < 0 || target >= entries.length) return current;
      [entries[index], entries[target]] = [entries[target], entries[index]];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await saveMenuOrder(groups);
      const next = cloneGroups(data.groups);
      setGroups(next);
      setSavedGroups(cloneGroups(next));
      setIsDefault(false);
      message.success('菜单排序已保存；刷新页面后对所有用户生效');
    } catch (error: any) {
      message.error(error?.message || '保存菜单排序失败');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => Modal.confirm({
    title: '恢复默认菜单排序？',
    content: '将删除管理员自定义排序，并恢复代码内的默认顺序。',
    okText: '恢复默认',
    okButtonProps: { danger: true },
    cancelText: '取消',
    onOk: async () => {
      const data = await resetMenuOrder();
      const next = cloneGroups(data.groups);
      setGroups(next);
      setSavedGroups(cloneGroups(next));
      setIsDefault(true);
      message.success('已恢复默认菜单排序');
    },
  });

  return (
    <div>
      <PageHeader
        title="菜单排序管理"
        description="仅调整各一级菜单内的显示顺序；路由、权限与一级菜单结构保持不变。"
        actions={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button><Button danger disabled={loading || isDefault} onClick={reset}>恢复默认</Button><Button type="primary" icon={<SaveOutlined />} disabled={!dirty || loading} loading={saving} onClick={() => void save()}>保存排序</Button></Space>}
      />
      <Alert type="info" showIcon message="使用上下箭头调整顺序" description="保存后会记录审计日志。新菜单尚未配置时，按代码内默认顺序显示在所属分组末尾。" style={{ marginBottom: 16 }} />
      {loading ? <Spin /> : <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {GROUPS.map((group) => {
          const entries = groups[group.key] || [];
          return <Card key={group.key} title={group.label} size="small">
            <List
              dataSource={entries}
              renderItem={(item, index) => <List.Item actions={[
                <Button key="up" size="small" aria-label={`上移 ${LABELS[item] || item}`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(group.key, index, -1)} />,
                <Button key="down" size="small" aria-label={`下移 ${LABELS[item] || item}`} icon={<ArrowDownOutlined />} disabled={index === entries.length - 1} onClick={() => move(group.key, index, 1)} />,
              ]}>
                <Space><Tag>{index + 1}</Tag><Text>{LABELS[item] || item}</Text></Space>
              </List.Item>}
            />
          </Card>;
        })}
      </Space>}
    </div>
  );
};

export default MenuOrderManagementPage;
