import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import {
  Table,
  Button,
  App,
  Spin,
  Space,
  Alert,
  Tag,
  Modal,
  Select,
  Typography,
  Form,
  Input,
  InputNumber,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  getSecurityGroupRules,
  addSecurityGroupRule,
  removeSecurityGroupRule,
  getPlatforms,
} from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';

type IpPermission = JsonRecord & {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: IpRange[];
  UserIdGroupPairs?: UserIdGroupPair[];
};

type SecurityGroupRuleForm = {
  protocol: string;
  fromPort: number;
  toPort: number;
  cidrIp: string;
  description?: string;
};

type DisplayRule = {
  protocol?: string;
  fromPort?: number;
  toPort?: number;
  originalPermission: IpPermission;
};

interface IpRange {
  CidrIp?: string;
  Description?: string;
}

interface UserIdGroupPair {
  Description?: string;
  UserId?: string;
  GroupName?: string;
  GroupId?: string;
  VpcId?: string;
  VpcPeeringConnectionId?: string;
  PeeringStatus?: string;
}

interface Platform {
  name: string;
  loadBalancerArn: string;
}

const SecurityGroupPage: React.FC = () => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const { currentEnvironment } = useContext(EnvironmentContext);

  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selectedPlatformArn, setSelectedPlatformArn] = useState<string | null>(null);
  const [rawRules, setRawRules] = useState<IpPermission[]>([]);
  const [loading, setLoading] = useState({ platforms: false, rules: false });
  const [actionLoading, setActionLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);

  const fetchPlatforms = useCallback(async () => {
    if (!currentEnvironment) return;
    setLoading((prev) => ({ ...prev, platforms: true }));
    try {
      const data = await getPlatforms();
      setPlatforms(data || []);
      // Set the first platform as selected by default, or clear if no platforms
      if (data?.length > 0) {
        setSelectedPlatformArn(data[0].loadBalancerArn);
      } else {
        setSelectedPlatformArn(null);
        setRawRules([]);
      }
    } catch (error: unknown) {
      message.error(`获取平台列表失败: ${(error as ApiError).response?.data?.message || (error as ApiError).message}`);
    } finally {
      setLoading((prev) => ({ ...prev, platforms: false }));
    }
  }, [currentEnvironment, message]);

  const fetchRules = useCallback(async () => {
    if (!selectedPlatformArn) {
      setRawRules([]);
      return;
    }
    setLoading((prev) => ({ ...prev, rules: true }));
    try {
      const data = await getSecurityGroupRules(selectedPlatformArn);
      setRawRules(data || []);
    } catch (error: unknown) {
      const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
      message.error(`获取安全组规则失败: ${errorMessage}`);
      setRawRules([]); // Clear rules on error
    } finally {
      setLoading((prev) => ({ ...prev, rules: false }));
    }
  }, [selectedPlatformArn, message]);

  useEffect(() => {
    if (currentEnvironment) {
      fetchPlatforms();
    } else {
      setPlatforms([]);
      setSelectedPlatformArn(null);
      setRawRules([]);
    }
  }, [currentEnvironment, fetchPlatforms]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleAddRule = async (values: SecurityGroupRuleForm) => {
    if (!selectedPlatformArn) return;
    setActionLoading(true);
    try {
      const response = await addSecurityGroupRule(selectedPlatformArn, values);
      message.success(response.message);
      setIsModalVisible(false);
      await fetchRules();
    } catch (error: unknown) {
      const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
      message.error(`添加失败: ${errorMessage}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveRule = (ruleToRemove: IpPermission) => {
    if (!selectedPlatformArn) return;
    modal.confirm({
      title: '确认删除规则',
      content: `你确定要删除这条规则吗？ (Source: ${
        ruleToRemove.IpRanges?.[0]?.CidrIp || 'N/A'
      })`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          // The backend expects the exact IpPermission object
          await removeSecurityGroupRule(selectedPlatformArn, ruleToRemove);
          message.success('规则已删除');
          await fetchRules();
        } catch (error: unknown) {
          const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
          message.error(`删除失败: ${errorMessage}`);
        }
      },
    });
  };

  // Flatten the rules for display, as one IpPermission can have multiple CIDR ranges
  const displayRules = useMemo(() => {
    return rawRules.flatMap((permission, permIndex) => {
      const common = {
        protocol: permission.IpProtocol,
        fromPort: permission.FromPort,
        toPort: permission.ToPort,
      };

      const ipRanges = (permission.IpRanges || []).map(
        (range: IpRange, rangeIndex: number) => ({
          ...common,
          key: `ip-${permIndex}-${rangeIndex}`,
          source: range.CidrIp,
          description: range.Description,
          originalPermission: {
            IpProtocol: permission.IpProtocol,
            FromPort: permission.FromPort,
            ToPort: permission.ToPort,
            IpRanges: [range],
          },
        }),
      );

      const userIdGroupPairs = (permission.UserIdGroupPairs || []).map(
        (group: UserIdGroupPair, groupIndex: number) => ({
          ...common,
          key: `sg-${permIndex}-${groupIndex}`,
          source: group.GroupId,
          description: group.Description,
          originalPermission: {
            IpProtocol: permission.IpProtocol,
            FromPort: permission.FromPort,
            ToPort: permission.ToPort,
            UserIdGroupPairs: [group],
          },
        }),
      );

      // Note: Ipv6Ranges are ignored for now but can be added here in the same way.

      return [...ipRanges, ...userIdGroupPairs];
    });
  }, [rawRules]);

  const columns = [
    {
      title: '协议',
      dataIndex: 'protocol',
      key: 'protocol',
      render: (p: string) => <Tag>{p === '-1' ? 'ALL' : p.toUpperCase()}</Tag>,
    },
    {
      title: '端口范围',
      key: 'port',
      render: (_: unknown, r: DisplayRule) =>
        r.protocol === '-1'
          ? 'All'
          : r.fromPort === r.toPort
          ? r.fromPort
          : `${r.fromPort}-${r.toPort}`,
    },
    { title: '来源', dataIndex: 'source', key: 'source' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: DisplayRule) => (
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleRemoveRule(r.originalPermission)}
        >
          删除
        </Button>
      ),
    },
  ];

  if (!currentEnvironment) {
    return <Alert message="请先在页面顶部选择一个项目环境" type="info" />;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Typography.Text>选择管理平台:</Typography.Text>
        <Select
          style={{ width: 240 }}
          value={selectedPlatformArn}
          onChange={setSelectedPlatformArn}
          options={platforms.map((p) => ({
            label: p.name,
            value: p.loadBalancerArn,
          }))}
          loading={loading.platforms}
          disabled={platforms.length === 0}
          placeholder="请选择一个平台"
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setIsModalVisible(true)}
          disabled={!selectedPlatformArn}
        >
          添加入站规则
        </Button>
      </Space>

      <Spin spinning={loading.rules}>
        <Table
          columns={columns}
          dataSource={displayRules}
          title={() => <h3>当前安全组入站规则</h3>}
          pagination={false}
          expandable={{
            expandedRowRender: (record) => (
              <pre style={{ margin: 0 }}>
                {JSON.stringify(record.originalPermission, null, 2)}
              </pre>
            ),
          }}
        />
      </Spin>
      <Modal
        title="添加入站规则"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        destroyOnClose
        afterClose={() => form.resetFields()}
      >
        <Form form={form} layout="vertical" onFinish={handleAddRule} style={{ marginTop: 24 }} initialValues={{ protocol: 'tcp', fromPort: 443, toPort: 443 }}>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Select options={[{value: 'tcp', label: 'TCP'}, {value: 'udp', label: 'UDP'}, {value: 'icmp', label: 'ICMP'}, {value: '-1', label: 'All'}]} />
          </Form.Item>
          <Form.Item name="fromPort" label="起始端口" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="toPort" label="结束端口" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cidrIp" label="来源 (CIDR)" rules={[{ required: true, message: '请输入有效的 CIDR, e.g., 1.2.3.4/32' }]}>
            <Input placeholder="例如: 1.2.3.4/32" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="可选" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={actionLoading}>
              添加
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default SecurityGroupPage;
