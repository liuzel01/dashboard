import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  createAccessRole,
  createAccessUser,
  deleteAccessRole,
  getAccessPermissions,
  getAccessRoles,
  getAccessUsers,
  confirmAccessUserMfaEnrollment,
  disableAccessUserMfa,
  resetAccessUserPassword,
  startAccessUserMfaEnrollment,
  updateAccessRole,
  updateAccessRolePermissions,
  updateAccessUser,
  type AccessUserMfaEnrollment,
} from '../services/api';

const { Title, Text } = Typography;

type AccessUser = {
  id: number;
  username: string;
  display_name?: string | null;
  status: 'active' | 'disabled';
  last_login_at?: string | null;
  role_ids: number[];
  role_names: string[];
  mfa_enabled: boolean;
  mfa_pending: boolean;
};

type AccessRole = {
  id: number;
  name: string;
  description?: string | null;
  user_count: number;
  permission_ids: number[];
};

type AccessPermission = {
  id: number;
  key: string;
  name: string;
};

const statusTag = (status: 'active' | 'disabled') =>
  status === 'active' ? <Tag color="green">启用</Tag> : <Tag color="default">禁用</Tag>;

const formatUtcToBeijing = (value?: string | null) => {
  if (!value) return '-';
  const m = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!m) return String(value);
  const [, y, mo, d, h, mi, s] = m;
  const utcDate = new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    ),
  );
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(utcDate);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

const AccountManagementPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AccessUser | null>(null);
  const [userForm] = Form.useForm();

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AccessRole | null>(null);
  const [roleForm] = Form.useForm();

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetUser, setResetUser] = useState<AccessUser | null>(null);
  const [resetForm] = Form.useForm();

  const [rolePermissions, setRolePermissions] = useState<Record<number, number[]>>({});
  const [dirtyRoleIds, setDirtyRoleIds] = useState<Set<number>>(new Set());
  const [userSaving, setUserSaving] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [mfaUser, setMfaUser] = useState<AccessUser | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<AccessUserMfaEnrollment | null>(null);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSaving, setMfaSaving] = useState(false);

  const refreshUsers = async () => {
    const usersData = await getAccessUsers();
    setUsers(usersData || []);
  };

  const refreshRoles = async () => {
    const rolesData = await getAccessRoles();
    setRoles(rolesData || []);
  };

  const refreshPermissions = async () => {
    const permissionsData = await getAccessPermissions();
    setPermissions(permissionsData || []);
  };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([refreshUsers(), refreshRoles(), refreshPermissions()]);
    } catch (e: any) {
      setError(e?.message || '加载账号管理数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    const nextMap: Record<number, number[]> = {};
    roles.forEach((role) => {
      nextMap[role.id] = role.permission_ids || [];
    });
    setRolePermissions(nextMap);
    setDirtyRoleIds(new Set());
  }, [roles]);

  const openMfaBinding = async (user: AccessUser) => {
    try {
      setMfaSaving(true);
      setMfaUser(user);
      setMfaEnrollment(await startAccessUserMfaEnrollment(user.id));
      setMfaCode('');
      setMfaModalOpen(true);
    } catch (e: any) {
      message.error(e?.message || '生成用户 MFA 绑定信息失败');
    } finally {
      setMfaSaving(false);
    }
  };

  const handleConfirmUserMfa = async () => {
    if (!mfaUser || !/^\d{6}$/.test(mfaCode)) {
      message.error('请输入目标用户设备当前显示的 6 位验证码');
      return;
    }
    try {
      setMfaSaving(true);
      await confirmAccessUserMfaEnrollment(mfaUser.id, mfaCode);
      setMfaModalOpen(false);
      setMfaEnrollment(null);
      setMfaCode('');
      message.success(`用户 ${mfaUser.username} 的 MFA 已绑定`);
      await refreshUsers();
    } catch (e: any) {
      message.error(e?.message || '确认用户 MFA 绑定失败');
    } finally {
      setMfaSaving(false);
    }
  };

  const handleDisableUserMfa = (user: AccessUser) => {
    Modal.confirm({
      title: `解除用户 ${user.username} 的 MFA？`,
      content: '解除后，该用户需要重新绑定 MFA 才能执行需要 MFA 的敏感操作。',
      okText: '确认解除',
      cancelText: '取消',
      onOk: async () => {
        try {
          setMfaSaving(true);
          await disableAccessUserMfa(user.id);
          message.success(`用户 ${user.username} 的 MFA 已解除`);
          await refreshUsers();
        } catch (e: any) {
          message.error(e?.message || '解除用户 MFA 失败');
          throw e;
        } finally {
          setMfaSaving(false);
        }
      },
    });
  };

  const openCreateUser = () => {
    setEditingUser(null);
    userForm.resetFields();
    userForm.setFieldsValue({ status: true, roleIds: [] });
    setUserModalOpen(true);
  };

  const openEditUser = (user: AccessUser) => {
    setEditingUser(user);
    userForm.resetFields();
    userForm.setFieldsValue({
      username: user.username,
      displayName: user.display_name || '',
      status: user.status === 'active',
      roleIds: user.role_ids,
    });
    setUserModalOpen(true);
  };

  const handleSaveUser = async () => {
    const values = await userForm.validateFields();
    const status: 'active' | 'disabled' = values.status ? 'active' : 'disabled';
    const payload = {
      username: values.username,
      displayName: values.displayName?.trim() || undefined,
      status,
      roleIds: values.roleIds || [],
    };

    try {
      setUserSaving(true);
      if (editingUser) {
        await updateAccessUser(editingUser.id, payload);
        message.success('用户已更新');
      } else {
        const result = await createAccessUser({
          ...payload,
          password: values.password?.trim() || undefined,
        });
        message.success('用户已创建');
        if (result?.initialPassword) {
          Modal.info({
            title: '初始密码',
            content: `该用户的初始密码为: ${result.initialPassword}`,
          });
        }
      }
      setUserModalOpen(false);
      await Promise.all([refreshUsers(), refreshRoles()]);
    } catch (e: any) {
      message.error(e?.message || '保存用户失败');
    } finally {
      setUserSaving(false);
    }
  };

  const openCreateRole = () => {
    setEditingRole(null);
    roleForm.resetFields();
    setRoleModalOpen(true);
  };

  const openEditRole = (role: AccessRole) => {
    setEditingRole(role);
    roleForm.resetFields();
    roleForm.setFieldsValue({ name: role.name, description: role.description });
    setRoleModalOpen(true);
  };

  const handleSaveRole = async () => {
    const values = await roleForm.validateFields();
    try {
      setRoleSaving(true);
      if (editingRole) {
        await updateAccessRole(editingRole.id, values);
        message.success('角色已更新');
      } else {
        await createAccessRole(values);
        message.success('角色已创建');
      }
      setRoleModalOpen(false);
      await Promise.all([refreshRoles(), refreshUsers()]);
    } catch (e: any) {
      message.error(e?.message || '保存角色失败');
    } finally {
      setRoleSaving(false);
    }
  };

  const handleDeleteRole = async (role: AccessRole) => {
    try {
      setRoleSaving(true);
      await deleteAccessRole(role.id);
      message.success('角色已删除');
      await Promise.all([refreshRoles(), refreshUsers()]);
    } catch (e: any) {
      message.error(e?.message || '删除角色失败');
    } finally {
      setRoleSaving(false);
    }
  };

  const openResetPassword = (user: AccessUser) => {
    setResetUser(user);
    resetForm.resetFields();
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    const values = await resetForm.validateFields();
    try {
      setResetSaving(true);
      const result = await resetAccessUserPassword(resetUser!.id, values.password?.trim() || undefined);
      setResetModalOpen(false);
      if (result?.password) {
        Modal.info({
          title: '新密码',
          content: `新密码为: ${result.password}`,
        });
      } else {
        message.success('密码已重置');
      }
    } catch (e: any) {
      message.error(e?.message || '重置密码失败');
    } finally {
      setResetSaving(false);
    }
  };

  const handleSavePermissions = async () => {
    const targetRoleIds = Array.from(dirtyRoleIds);
    if (targetRoleIds.length === 0) return;
    try {
      setPermissionsSaving(true);
      await Promise.all(
        targetRoleIds.map((roleId) =>
          updateAccessRolePermissions(roleId, rolePermissions[roleId] || []),
        ),
      );
      const latestRoles = await getAccessRoles();
      setRoles(latestRoles || []);
      message.success('权限已更新');
    } catch (e: any) {
      message.error(e?.message || '更新权限失败');
    } finally {
      setPermissionsSaving(false);
    }
  };

  const togglePermission = (roleId: number, permId: number, checked: boolean) => {
    setRolePermissions((prev) => {
      const current = new Set(prev[roleId] || []);
      if (checked) {
        current.add(permId);
      } else {
        current.delete(permId);
      }
      return { ...prev, [roleId]: Array.from(current) };
    });
    setDirtyRoleIds((prev) => {
      const next = new Set(prev);
      next.add(roleId);
      return next;
    });
  };

  const userColumns = useMemo(
    () => [
      { title: '显示名称', dataIndex: 'display_name', width: 160, render: (v: string, r: AccessUser) => v || r.username },
      { title: '登录账号', dataIndex: 'username', width: 220 },
      {
        title: '角色',
        dataIndex: 'role_names',
        render: (value: string[]) =>
          value && value.length > 0 ? (
            <Space size={4} wrap>
              {value.map((name) => (
                <Tag key={name}>{name}</Tag>
              ))}
            </Space>
          ) : (
            <Text type="secondary">未分配</Text>
          ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 100,
        render: (value: 'active' | 'disabled') => statusTag(value),
      },
      {
        title: 'MFA 状态',
        key: 'mfa',
        width: 110,
        render: (_: unknown, record: AccessUser) => record.mfa_enabled
          ? <Tag color="green">已绑定</Tag>
          : record.mfa_pending
            ? <Tag color="orange">待确认</Tag>
            : <Tag>未绑定</Tag>,
      },
      {
        title: '最近登录(北京时间)',
        dataIndex: 'last_login_at',
        width: 180,
        render: (value: string | null) => formatUtcToBeijing(value),
      },
          {
            title: '操作',
            key: 'action',
            width: 260,
            render: (_: any, record: AccessUser) => (
              <Space>
                <Button type="link" icon={<EditOutlined />} onClick={() => openEditUser(record)}>
                  编辑
                </Button>
                {String(record.username || '').toLowerCase() === 'admin' && (
                  <Button type="link" icon={<KeyOutlined />} onClick={() => openResetPassword(record)}>
                    重置密码
                  </Button>
                )}
                {record.mfa_enabled ? (
                  <Button type="link" danger loading={mfaSaving && mfaUser?.id === record.id} onClick={() => handleDisableUserMfa(record)}>
                    解绑 MFA
                  </Button>
                ) : (
                  <Button type="link" loading={mfaSaving && mfaUser?.id === record.id} onClick={() => openMfaBinding(record)}>
                    {record.mfa_pending ? '继续绑定' : '绑定 MFA'}
                  </Button>
                )}
              </Space>
            ),
          },
    ],
    [],
  );

  const roleColumns = useMemo(
    () => [
      { title: '角色', dataIndex: 'name', width: 160 },
      { title: '描述', dataIndex: 'description', render: (value: string) => value || '-' },
      { title: '用户数', dataIndex: 'user_count', width: 100 },
      {
        title: '操作',
        key: 'action',
        width: 200,
        render: (_: any, record: AccessRole) => (
          <Space>
            <Button type="link" onClick={() => openEditRole(record)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除该角色？"
              okText="删除"
              cancelText="取消"
              onConfirm={() => handleDeleteRole(record)}
            >
              <Button type="link" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <Space style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ marginBottom: 0 }}>
            账号与权限
          </Title>
          <Text type="secondary">管理用户账号、角色与菜单权限</Text>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateUser}>
            新增用户
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>
            刷新
          </Button>
        </Space>
      </Space>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Card title="用户列表" size="small" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          columns={userColumns}
          dataSource={users}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>

      <Card
        title="角色列表"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRole}>
            新增角色
          </Button>
        }
      >
        <Table
          rowKey="id"
          columns={roleColumns}
          dataSource={roles}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>

      <Card title="权限配置" size="small">
        <Table
          rowKey="id"
          dataSource={permissions}
          pagination={false}
          loading={loading}
          columns={[
            {
              title: '菜单',
              dataIndex: 'name',
              width: 220,
              render: (_: any, record: AccessPermission) => (
                <div>
                  <div>{record.name}</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{record.key}</Text>
                </div>
              ),
            },
            ...roles.map((role) => ({
              title: role.name,
              dataIndex: `role_${role.id}`,
              width: 120,
              align: 'center' as const,
              render: (_: any, perm: AccessPermission) => (
                <Checkbox
                  checked={(rolePermissions[role.id] || []).includes(perm.id)}
                  onChange={(e) => togglePermission(role.id, perm.id, e.target.checked)}
                />
              ),
            })),
          ]}
          size="small"
        />
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" loading={permissionsSaving} disabled={dirtyRoleIds.size === 0 || permissionsSaving} onClick={handleSavePermissions}>
            保存权限
          </Button>
          {dirtyRoleIds.size > 0 && (
            <Text type="secondary">有未保存的权限变更</Text>
          )}
        </Space>
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        open={userModalOpen}
        onCancel={() => setUserModalOpen(false)}
        onOk={handleSaveUser}
        confirmLoading={userSaving}
        okText="保存"
        destroyOnClose
      >
        <Form form={userForm} layout="vertical">
          <Form.Item label="显示名称" name="displayName">
            <Input placeholder="例如：Lemo" disabled={!!editingUser} />
          </Form.Item>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input disabled={!!editingUser} />
          </Form.Item>

          {!editingUser && (
            <Form.Item label="初始密码" name="password">
              <Input.Password placeholder="留空将自动生成" />
            </Form.Item>
          )}

          <Form.Item label="角色" name="roleIds">
            <Select mode="multiple" placeholder="选择角色">
              {roles.map((role) => (
                <Select.Option key={role.id} value={role.id}>
                  {role.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label="状态" name="status" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRole ? '编辑角色' : '新增角色'}
        open={roleModalOpen}
        onCancel={() => setRoleModalOpen(false)}
        onOk={handleSaveRole}
        confirmLoading={roleSaving}
        okText="保存"
        destroyOnClose
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item
            label="角色名称"
            name="name"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重置密码"
        open={resetModalOpen}
        onCancel={() => setResetModalOpen(false)}
        onOk={handleResetPassword}
        confirmLoading={resetSaving}
        okText="确认"
        destroyOnClose
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item>
            <Text>用户: {resetUser?.username}</Text>
          </Form.Item>
          <Form.Item label="新密码" name="password">
            <Input.Password placeholder="留空将自动生成" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`为用户 ${mfaUser?.username || ''} 绑定 MFA`}
        open={mfaModalOpen}
        onCancel={() => setMfaModalOpen(false)}
        onOk={handleConfirmUserMfa}
        confirmLoading={mfaSaving}
        okText="确认绑定"
        cancelText="取消"
        destroyOnClose
      >
        {mfaEnrollment && (
          <Space direction="vertical" size="small">
            <Alert
              type="warning"
              showIcon
              message="请将二维码或手动密钥安全地交给目标用户，仅用于该用户设备绑定。"
            />
            <Text>请让目标用户使用 Google Authenticator 扫描二维码，然后提供设备当前显示的 6 位验证码。</Text>
            <img src={mfaEnrollment.qrCodeDataUrl} alt="用户 MFA 二维码" style={{ width: 180, height: 180 }} />
            <Text copyable={{ text: mfaEnrollment.secret }}>手动设置密钥：{mfaEnrollment.secret}</Text>
            <Input
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="输入目标用户设备显示的 6 位验证码"
              maxLength={6}
              inputMode="numeric"
            />
          </Space>
        )}
      </Modal>

    </div>
  );
};

export default AccountManagementPage;
