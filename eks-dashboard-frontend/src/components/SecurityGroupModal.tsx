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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table,
  Button,
  App,
  Spin,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  getRulesForSg,
  addRuleToSg,
  removeRuleFromSg,
} from '../services/api';

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
  key: string;
  protocol?: string;
  fromPort?: number;
  toPort?: number;
  source?: string;
  description?: string;
  originalPermission: IpPermission;
};

interface SecurityGroupModalProps {
  visible: boolean;
  onClose: () => void;
  securityGroupId: string;
  securityGroupName: string;
}

export const SecurityGroupModal: React.FC<SecurityGroupModalProps> = ({
  visible,
  onClose,
  securityGroupId,
  securityGroupName,
}) => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();

  const [rawRules, setRawRules] = useState<IpPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRules = useCallback(async () => {
    if (!securityGroupId) return;
    setLoading(true);
    try {
      const data = await getRulesForSg(securityGroupId);
      setRawRules(data || []);
    } catch (error: unknown) {
      message.error(`获取规则失败: ${(error as ApiError).response?.data?.message || (error as ApiError).message}`);
    } finally {
      setLoading(false);
    }
  }, [securityGroupId, message]);

  useEffect(() => {
    if (visible) {
      fetchRules();
    }
  }, [visible, fetchRules]);

  const handleAddRule = async (values: SecurityGroupRuleForm) => {
    setActionLoading(true);
    try {
      await addRuleToSg(securityGroupId, values);
      message.success('规则添加成功');
      setIsAddModalVisible(false);
      await fetchRules();
    } catch (error: unknown) {
      message.error(`添加失败: ${(error as ApiError).response?.data?.message || (error as ApiError).message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveRule = (ruleToRemove: IpPermission) => {
    modal.confirm({
      title: '确认删除规则',
      content: `你确定要删除这条规则吗？ (Source: ${ruleToRemove.IpRanges?.[0]?.CidrIp || ruleToRemove.UserIdGroupPairs?.[0]?.GroupId || 'N/A'})`,
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        try {
          await removeRuleFromSg(securityGroupId, ruleToRemove);
          message.success('规则已删除');
          await fetchRules();
        } catch (error: unknown) {
          message.error(`删除失败: ${(error as ApiError).response?.data?.message || (error as ApiError).message}`);
        }
      },
    });
  };

  const displayRules = useMemo(() => {
    return rawRules.flatMap((permission, permIndex) => {
      const common = {
        protocol: permission.IpProtocol,
        fromPort: permission.FromPort,
        toPort: permission.ToPort,
      };
const ipRanges = (permission.IpRanges || []).map((range: IpRange, rangeIndex: number) => ({
        ...common,
        key: `ip-${permIndex}-${rangeIndex}`,
        source: range.CidrIp,
        description: range.Description,
        originalPermission: { ...permission, IpRanges: [range], UserIdGroupPairs: [] },
      }));
const userIdGroupPairs = (permission.UserIdGroupPairs || []).map((group: UserIdGroupPair, groupIndex: number) => ({
        ...common,
        key: `sg-${permIndex}-${groupIndex}`,
        source: group.GroupId,
        description: group.Description,
        originalPermission: { ...permission, IpRanges: [], UserIdGroupPairs: [group] },
      }));
      return [...ipRanges, ...userIdGroupPairs];
    });
  }, [rawRules]);

  const columns = [
    { title: '协议', dataIndex: 'protocol', key: 'protocol', render: (p: string) => <Tag>{p === '-1' ? 'ALL' : p.toUpperCase()}</Tag> },
    { title: '端口范围', key: 'port', render: (_: unknown, r: DisplayRule) => r.protocol === '-1' ? 'All' : (r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}-${r.toPort}`) },
    { title: '来源', dataIndex: 'source', key: 'source' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '操作', key: 'action', render: (_: unknown, r: DisplayRule) => <Button danger icon={<DeleteOutlined />} onClick={() => handleRemoveRule(r.originalPermission)}>删除</Button> },
  ];

  return (
    <>
      <Modal
        title={`安全组规则: ${securityGroupName} (${securityGroupId})`}
        open={visible}
        onCancel={onClose}
        width="80vw"
        footer={[
          <Button key="close" onClick={onClose}>
            关闭
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsAddModalVisible(true)}
          >
            添加入站规则
          </Button>
          <Spin spinning={loading}>
            <Table
              columns={columns}
              dataSource={displayRules}
              pagination={false}
              size="small"
              expandable={{
                expandedRowRender: (record) => <pre style={{ margin: 0 }}>{JSON.stringify(record.originalPermission, null, 2)}</pre>,
              }}
            />
          </Spin>
        </Space>
      </Modal>

      <Modal
        title="添加入站规则"
        open={isAddModalVisible}
        onCancel={() => setIsAddModalVisible(false)}
        footer={null}
        destroyOnClose
        afterClose={() => form.resetFields()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddRule}
          style={{ marginTop: 24 }}
          initialValues={{ protocol: 'tcp', fromPort: 3389, toPort: 3389 }}
        >
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Select options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }, { value: '-1', label: 'All' }]} />
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
            <Input.TextArea placeholder="可选, 例如: 'Home IP for dev'" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={actionLoading}>
              添加
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
