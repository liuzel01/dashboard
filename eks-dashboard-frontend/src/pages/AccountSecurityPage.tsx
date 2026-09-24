import React from 'react';
import { Space, Typography } from 'antd';
import MfaManagementCard from '../components/MfaManagementCard';

const { Title, Text } = Typography;

const AccountSecurityPage: React.FC = () => (
  <div>
    <Space direction="vertical" size={4} style={{ display: 'flex', marginBottom: 16 }}>
      <Title level={4} style={{ margin: 0 }}>账号安全 / MFA 管理</Title>
      <Text type="secondary">管理当前登录账号的 Google Authenticator 绑定，不涉及其他用户的账号和权限。</Text>
    </Space>
    <MfaManagementCard />
  </div>
);

export default AccountSecurityPage;
