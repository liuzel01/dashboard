import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, List, Modal, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CaretDownOutlined, CaretRightOutlined, HolderOutlined, InfoCircleOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { getMenuOrder, type MenuCatalogGroup, type MenuOrderMap, resetMenuOrder, saveMenuOrder } from '../services/api';
import { PageHeader } from '../components/ops';
import { writeCachedMenuOrder } from '../utils/menuOrderCache';

const { Text } = Typography;

const cloneGroups = (groups: MenuOrderMap): MenuOrderMap =>
  Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, [...values]]));

type DragSource = { groupKey: string; index: number } | null;

const MenuOrderManagementPage: React.FC = () => {
  const [groups, setGroups] = useState<MenuOrderMap>({});
  const [savedGroups, setSavedGroups] = useState<MenuOrderMap>({});
  const [catalog, setCatalog] = useState<MenuCatalogGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragSource, setDragSource] = useState<DragSource>(null);
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
      setCatalog(data.catalog || []);
      setIsDefault(Boolean(data.isDefault));
    } catch (error: unknown) {
      message.error((error as ApiError)?.response?.data?.message || (error as ApiError)?.message || '加载菜单排序失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const reorder = (groupKey: string, from: number, to: number) => {
    if (from === to) return;
    setGroups((current) => {
      const next = cloneGroups(current);
      const entries = next[groupKey] || [];
      if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) return current;
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
      return next;
    });
  };

  const toggleExpanded = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const data = await saveMenuOrder(groups);
      const next = cloneGroups(data.groups);
      setGroups(next);
      setSavedGroups(cloneGroups(next));
      setIsDefault(false);
      writeCachedMenuOrder(next);
      message.success('菜单排序已保存；刷新页面后对所有用户生效');
    } catch (error: unknown) {
      message.error((error as ApiError)?.response?.data?.message || (error as ApiError)?.message || '保存菜单排序失败');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => Modal.confirm({
    title: '恢复默认菜单排序？',
    content: '将删除管理员自定义排序，并恢复代码内的默认顺序。',
    okText: '恢复默认', okButtonProps: { danger: true }, cancelText: '取消',
    onOk: async () => {
      const data = await resetMenuOrder();
      const next = cloneGroups(data.groups);
      setGroups(next);
      setSavedGroups(cloneGroups(next));
      setIsDefault(true);
      writeCachedMenuOrder(next);
      message.success('已恢复默认菜单排序');
    },
  });

  const renderEntries = (groupKey: string, depth = 0): React.ReactNode => {
    const entries = groups[groupKey] || [];
    const labels = new Map(catalog.flatMap((group) => group.items.map((item) => [item.key, item.label])));
    return <List
      size="small"
      dataSource={entries}
      renderItem={(item, index) => {
        const nested = Boolean(groups[item]);
        const open = expanded.has(item);
        return <React.Fragment key={item}>
          <List.Item
            draggable
            onDragStart={() => setDragSource({ groupKey, index })}
            onDragEnd={() => setDragSource(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragSource?.groupKey === groupKey) reorder(groupKey, dragSource.index, index);
              setDragSource(null);
            }}
            style={{ paddingLeft: depth * 28, cursor: 'grab' }}
            actions={[
              <Button key="up" size="small" aria-label={`上移 ${labels.get(item) || item}`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => reorder(groupKey, index, index - 1)} />,
              <Button key="down" size="small" aria-label={`下移 ${labels.get(item) || item}`} icon={<ArrowDownOutlined />} disabled={index === entries.length - 1} onClick={() => reorder(groupKey, index, index + 1)} />,
            ]}
          >
            <Space>
              <HolderOutlined style={{ color: '#8c8c8c' }} />
              <Tag>{index + 1}</Tag>
              {nested && <Button type="text" size="small" aria-label={`${open ? '收起' : '展开'} ${labels.get(item) || item}`} icon={open ? <CaretDownOutlined /> : <CaretRightOutlined />} onClick={() => toggleExpanded(item)} />}
              <Text>{labels.get(item) || item}</Text>
            </Space>
          </List.Item>
          {nested && open && <div style={{ marginLeft: 20, borderLeft: '1px solid #f0f0f0' }}>{renderEntries(item, depth + 1)}</div>}
        </React.Fragment>;
      }}
    />;
  };

  return <div>
    <PageHeader
      title="菜单排序管理"
      description={<Space size={6} align="center"><span>仅调整各一级菜单内的显示顺序；点击可展开的父菜单可继续调整其子菜单。</span><Tooltip placement="bottomLeft" overlayStyle={{ maxWidth: 620 }} title={<div style={{ width: 460, lineHeight: 1.8, whiteSpace: 'normal' }}><div>支持拖拽或上下箭头调整同级菜单顺序。</div><div>调整只会立即更新当前预览；点击“保存排序”后才会写入全局配置并记录审计日志。</div></div>}><InfoCircleOutlined aria-label="菜单排序使用说明" style={{ color: '#1677ff', cursor: 'help' }} /></Tooltip></Space>}
      actions={<Space>{dirty && <Tag color="gold">排序已调整，尚未保存</Tag>}<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button><Button danger disabled={loading || isDefault} onClick={reset}>恢复默认</Button><Button type="primary" icon={<SaveOutlined />} disabled={!dirty || loading} loading={saving} onClick={() => void save()}>保存排序</Button></Space>}
    />
    {loading ? <Spin /> : <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {catalog.filter((group) => group.key !== '/access-control').map((group) => <Card key={group.key} title={group.label} size="small">{renderEntries(group.key)}</Card>)}
    </Space>}
  </div>;
};

export default MenuOrderManagementPage;
