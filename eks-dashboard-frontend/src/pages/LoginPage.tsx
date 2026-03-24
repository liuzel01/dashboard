import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';
import { getRuntimeConfig } from '../services/runtimeConfig';
import { resolveSsoRedirectUri } from '../services/sso';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = React.useContext(AuthContext);
  const [form] = Form.useForm();
  const [ssoReady, setSsoReady] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [config, setConfig] = useState<{ redirectUri: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const cfg = await getRuntimeConfig();
        const redirectUri = resolveSsoRedirectUri(cfg.SSO_REDIRECT_URI);
        setConfig({ redirectUri });
        setSsoReady(true);
      } catch (err: any) {
        setSsoError(err?.message || '加载 SSO 配置失败');
      }
    };
    load();
  }, []);

  const handleSubmit = async (values: { username: string; password: string }) => {
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      await login(values.username, values.password);
      navigate('/', { replace: true });
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '登录失败');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSsoLogin = async () => {
    if (!config) return;
    try {
      const url = `/api/auth/keycloak/login?redirectUri=${encodeURIComponent(config.redirectUri)}`;
      window.location.href = url;
    } catch (err: any) {
      message.error(err?.message || 'SSO 登录失败');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #6f7bf7 0%, #7a62c5 100%)' }}>
      <Card style={{ width: 420, borderRadius: 16, textAlign: 'center' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ width: 72, height: 72, margin: '0 auto 16px', borderRadius: '50%', background: '#d4ff3f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>O&amp;M</div>
          <Title level={4} style={{ marginBottom: 4 }}>运维平台</Title>
          <Text type="secondary">基础设施与服务管理</Text>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">当前环境仅支持 SSO 单点登录</Text>
        </div>

        <Button type="primary" block disabled={!ssoReady} onClick={handleSsoLogin} style={{ height: 40 }}>
          使用 SSO 登录
        </Button>
        {ssoError && <div style={{ marginTop: 8 }}><Text type="danger">{ssoError}</Text></div>}

        <div style={{ marginTop: 16 }}>
          <Button type="link" onClick={() => setShowLocal((v) => !v)}>
            管理员密码登录
          </Button>
        </div>

        {showLocal && (
          <Form
            form={form}
            layout="vertical"
            style={{ marginTop: 12, textAlign: 'left' }}
            onFinish={handleSubmit}
            disabled={loggingIn}
          >
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input
                autoComplete="username"
                onPressEnter={() => !loggingIn && form.submit()}
              />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                autoComplete="current-password"
                onPressEnter={() => !loggingIn && form.submit()}
              />
            </Form.Item>
            <Button type="default" block htmlType="submit" loading={loggingIn}>
              管理员登录
            </Button>
          </Form>
        )}

        <div style={{ marginTop: 16, color: '#999' }}>© 2026 运维平台 · Powered by mgbx</div>
      </Card>
    </div>
  );
};

export default LoginPage;
