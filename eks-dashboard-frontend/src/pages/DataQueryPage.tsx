import React, { useState } from 'react';
import {
  Input,
  Tabs,
  Spin,
  Card,
  Descriptions,
  Alert,
  Empty,
  Space,
  Button,
  Modal,
  App,
  Form,
  Dropdown,
  Menu,
} from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { aggregateQuery, updateUser, deactivateUser } from '../services/api';
import PlaceholderPage from './PlaceholderPage';

const { Search } = Input;
const { TabPane } = Tabs;

// 模拟数据结构
interface UserInfo {
  [key: string]: any;
}

interface RedisData {
  key: string;
  value: any;
}

const DataQueryPage: React.FC = () => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [redisData, setRedisData] = useState<RedisData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false); // 用于判断是否执行过搜索
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [lastSearchTerm, setLastSearchTerm] = useState('');

  const onSearch = async (value: string) => {
    if (!value.trim()) {
      return;
    }
    setLastSearchTerm(value);
    setLoading(true);
    setSearched(true);
    setError(null);

    try {
      // 简单地假设纯数字是UID，可以根据需要实现更复杂的类型推断
      const type = /^\d+$/.test(value) ? 'UID' : 'UID';
      const results = await aggregateQuery(value, type);

      setUserInfo(results.mysql.data || null);
      setRedisData(results.redis.data || null);

    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message;
      setError(`查询失败: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const showEditModal = () => {
    if (userInfo) {
      form.setFieldsValue({
        email: userInfo.email || '',
        tel: userInfo.tel || '',
        tel_country_code: userInfo.tel_country_code || '',
      });
      setIsEditModalVisible(true);
    }
  };

  const handleEditFormFinish = async (values: {
    email: string;
    tel: string;
    tel_country_code: string;
  }) => {
    if (!userInfo?.tenant_user_id) return;
    
    setEditLoading(true);

    const dataToUpdate: { [key: string]: any } = {};

    // Compare form values with original userInfo and send only changed fields.
    // This prevents re-validating unchanged but currently invalid fields (e.g., a deactivated email).
    if (values.email !== (userInfo.email || '')) {
      dataToUpdate.email = values.email;
    }
    if (values.tel !== (userInfo.tel || '')) {
      dataToUpdate.tel = values.tel;
    }
    if (values.tel_country_code !== (userInfo.tel_country_code || '')) {
      dataToUpdate.tel_country_code = values.tel_country_code;
    }

    if (Object.keys(dataToUpdate).length === 0) {
      message.info('未检测到任何更改。');
      setEditLoading(false);
      setIsEditModalVisible(false);
      return;
    }

    try {
      // The backend service will handle converting empty strings to null.
      await updateUser(userInfo.tenant_user_id, dataToUpdate);
      message.success('用户信息更新成功！');
      setIsEditModalVisible(false);
      await onSearch(lastSearchTerm); // 重新获取数据以刷新页面
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message;
      message.error(`更新失败: ${errorMessage}`);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!userInfo?.tenant_user_id) return;
    try {
      await deactivateUser(userInfo.tenant_user_id);
      message.success('账号已成功注销！');
      onSearch(lastSearchTerm); // 重新获取数据以刷新页面
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message;
      message.error(`注销失败: ${errorMessage}`);
    }
  };

  const showDeactivateConfirm = () => {
    modal.confirm({
      title: '确认注销账号？',
      content: `你确定要注销用户 ${userInfo?.tenant_user_id} 吗？此操作会将用户的邮箱和电话标记为已删除，但不会物理删除记录。`,
      okText: '确认注销',
      okType: 'danger',
      cancelText: '取消',
      onOk: handleDeactivate,
    });
  };

  const renderResults = () => {
    if (loading) {
      return <div style={{ textAlign: 'center', marginTop: 50 }}><Spin size="large" tip="正在聚合查询..." /></div>;
    }

    if (error) {
      return <Alert message="查询出错" description={error} type="error" showIcon />;
    }

    // 首次进入页面或未搜索时，显示提示信息
    if (!searched) {
      return <Alert message="请输入UID、手机号或邮箱等标识符进行统一查询。" type="info" showIcon />;
    }

    // 搜索后无结果
    if (searched && !loading && !userInfo && (!redisData || redisData.length === 0) && !error) {
        return <Empty description="未找到与查询条件相关的任何数据。" />;
    }

    const userActionsMenu = (
      <Menu>
        <Menu.Item key="edit" onClick={showEditModal}>
          编辑信息
        </Menu.Item>
        <Menu.Item key="deactivate" danger onClick={showDeactivateConfirm}>
          注销账号
        </Menu.Item>
      </Menu>
    );

    return (
      <Tabs defaultActiveKey="1" type="card">
        <TabPane tab="用户基本信息 (MySQL)" key="1">
          {userInfo ? (
            <Card
              title="用户详情 (常用字段)"
              extra={
                <Dropdown overlay={userActionsMenu}>
                  <Button>操作 <DownOutlined /></Button>
                </Dropdown>
              }
            >
              <Descriptions bordered column={1}>
                <Descriptions.Item label="UID">{userInfo.tenant_user_id || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Email">{userInfo.email || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Telephone">{userInfo.tel || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Telephone Country Code">{userInfo.tel_country_code || 'N/A'}</Descriptions.Item>

              </Descriptions>
              <Button
                type="link"
                style={{ marginTop: '16px', paddingLeft: 0 }}
                onClick={() => setIsDetailModalVisible(true)}
              >
                查看全部字段
              </Button>
            </Card>
          ) : ( <Empty description="无用户基本信息" /> )}
        </TabPane>
        <TabPane tab="缓存数据 (Redis)" key="2">
          {redisData && redisData.length > 0 ? (
            <Card>
              <Descriptions title="Redis 键值对" bordered column={1} size="small">
                {redisData.map(item => (
                  <Descriptions.Item key={item.key} label={item.key}>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, background: '#f5f5f5', padding: '8px', borderRadius: '4px' }}>
                      {JSON.stringify(item.value, null, 2)}
                    </pre>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          ) : ( <Empty description="无缓存数据" /> )}
        </TabPane>
        <TabPane tab="其他信息 (Mongo)" key="3">
          <PlaceholderPage />
        </TabPane>
      </Tabs>
    );
  };

  return (
    <div>
      <Space style={{ marginBottom: 24 }}>
        <Search
          placeholder="输入UID、手机号、邮箱等进行统一查询..."
          enterButton="查询"
          size="large"
          onSearch={onSearch}
          loading={loading}
          style={{ width: 400 }}
          allowClear
        />
      </Space>
      <div>
        {renderResults()}
      </div>
      <Modal
        title="编辑用户信息"
        open={isEditModalVisible}
        onCancel={() => setIsEditModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleEditFormFinish} style={{ marginTop: 24 }} autoComplete="off">
          <Form.Item name="email" label="邮箱">
            <Input placeholder="留空以清除邮箱" />
          </Form.Item>
          <Form.Item name="tel" label="电话">
            <Input placeholder="留空以清除电话和国家代码" />
          </Form.Item>
          <Form.Item
            name="tel_country_code"
            label="电话国家代码"
          >
            <Input placeholder="例如: 86" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={editLoading}>
              保存
            </Button>
          </Form.Item>
        </Form>
      </Modal>
      {userInfo && (
        <Modal
          title="用户所有字段信息"
          open={isDetailModalVisible}
          onCancel={() => setIsDetailModalVisible(false)}
          footer={[
            <Button key="back" onClick={() => setIsDetailModalVisible(false)}>
              关闭
            </Button>,
          ]}
          width={800}
        >
          <Descriptions bordered column={1} size="small" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {Object.entries(userInfo).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>{String(value)}</Descriptions.Item>
            ))}
          </Descriptions>
        </Modal>
      )}
    </div>
  );
};

export default DataQueryPage;