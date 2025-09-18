import React, { useState, useEffect, useMemo, useContext, useCallback } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Table, Button, message, Spin, Input, Space, App, Alert } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { getJumpServers, resetJumpServerPassword } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import { SecurityGroupModal } from '../components/SecurityGroupModal';

interface JumpServer {
  instanceId: string;
  name: string;
  instanceType: string;
  status: string;
  publicIpAddress: string;
  securityGroups: {
    id: string;
    name: string;
  }[];
  platformDetails: string;
}

const WindowsJumpServerPage: React.FC = () => {
  const { modal } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [allJumpServers, setAllJumpServers] = useState<JumpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);
  const [sgModalInfo, setSgModalInfo] = useState<{
    visible: boolean;
    groupId: string;
    groupName: string;
  } | null>(null);

  const jumpServers = useMemo(() => {
    if (!filter) {
      return allJumpServers;
    }
    return allJumpServers.filter((server) =>
      server.name.toLowerCase().includes(filter.toLowerCase())
    );
  }, [allJumpServers, filter]);

  const fetchJumpServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getJumpServers();
      setAllJumpServers(data);
      setError(null);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      setError(`获取跳板机列表失败: ${errorMessage}`);
      message.error(`获取跳板机列表失败: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (currentEnvironment) {
      fetchJumpServers();
    }
  }, [currentEnvironment, fetchJumpServers]);

  const handleResetAndGetPassword = async (record: JumpServer) => {
    if (!currentEnvironment) return;
    setResettingPasswordId(record.instanceId);
    try {
      const data = await resetJumpServerPassword(record.instanceId);
      const password = data.password;

      modal.info({
        title: `New Password for ${record.name}`,
        content: (
          <div>
            <p><strong>Username:</strong> administrator</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
              <Input.Password value={password} readOnly autoFocus />
              <Button
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(password);
                  message.success('Password copied!');
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        ),
        okText: 'Close',
        width: 520,
      });

    } catch (error: any) {
      message.error(`Failed to reset password: ${error.message}`);
    } finally {
      setResettingPasswordId(null);
    }
  };

  const columns: ColumnsType<JumpServer> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: '实例 ID', dataIndex: 'instanceId', key: 'instanceId' },
    { title: '实例类型', dataIndex: 'instanceType', key: 'instanceType' },
    { title: '实例状态', dataIndex: 'status', key: 'status' },
    { title: '公有 IPv4 地址', dataIndex: 'publicIpAddress', key: 'publicIpAddress' },
    {
      title: '安全组',
      dataIndex: 'securityGroups',
      key: 'securityGroups',
      render: (sgs: JumpServer['securityGroups']) => (
        <Space direction="vertical" size="small">
          {sgs.map((sg) => (
            <Button type="link" key={sg.id} style={{ padding: 0 }} onClick={() => setSgModalInfo({ visible: true, groupId: sg.id, groupName: sg.name })}>
              {sg.name}
            </Button>
          ))}
        </Space>
      ),
    },
    // { title: '平台详细信息', dataIndex: 'platformDetails', key: 'platformDetails' },
    {
      title: '操作',
      key: 'action',
      render: (_text, record: JumpServer) => (
        <Button
          type="primary"
          onClick={() => handleResetAndGetPassword(record)}
          loading={resettingPasswordId === record.instanceId}
        >
          重置并获取密码
        </Button>
      ),
    },
  ];

  if (!currentEnvironment) {
    return <Alert message="请先在页面顶部选择一个项目环境" type="info" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Space style={{ marginBottom: 20 }}>
        <Input
          placeholder="按名称模糊筛选..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 400 }}
          allowClear
        />
      </Space>
      {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Spin spinning={loading} size="large" tip="Loading...">
          <Table
            columns={columns}
            dataSource={jumpServers}
            rowKey="instanceId"
            // 显式配置分页，以确保在数据量少于一页时也显示分页器，保持UI一致性
            pagination={{ showSizeChanger: true, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items` }}
          />
        </Spin>
      </div>
      {sgModalInfo?.visible && (
        <SecurityGroupModal
          visible={sgModalInfo.visible}
          onClose={() => setSgModalInfo(null)}
          securityGroupId={sgModalInfo.groupId}
          securityGroupName={sgModalInfo.groupName}
        />
      )}
    </div>
  );
};

export default WindowsJumpServerPage;