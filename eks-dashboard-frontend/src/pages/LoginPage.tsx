import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContextValue';
import { getRuntimeConfig } from '../services/runtimeConfig';
import { resolveSsoRedirectUri } from '../services/sso';

const { Title, Text, Paragraph } = Typography;

type LocalLoginValues = {
  username: string;
  password: string;
  otpCode?: string;
};

type MfaSetupState = {
  username: string;
  secret: string;
  qrCodeDataUrl?: string;
  otpauthUrl?: string;
  message?: string;
};

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = React.useContext(AuthContext);
  const [form] = Form.useForm<LocalLoginValues>();
  const [ssoReady, setSsoReady] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [showLocal, setShowLocal] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<MfaSetupState | null>(null);
  const [config, setConfig] = useState<{ redirectUri: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const cfg = await getRuntimeConfig();
        const redirectUri = resolveSsoRedirectUri(cfg.SSO_REDIRECT_URI);
        setConfig({ redirectUri });
        setSsoReady(true);
      } catch (err: unknown) {
        setSsoError((err as ApiError)?.message || '加载 SSO 配置失败');
      }
    };
    load();
  }, []);

  const handleSubmit = async (values: LocalLoginValues) => {
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      const resp = await login(values.username, values.password, values.otpCode);
      if (resp?.mfaSetupRequired) {
        setMfaSetup({
          username: resp.username || values.username,
          secret: resp.secret || '',
          qrCodeDataUrl: resp.qrCodeDataUrl,
          otpauthUrl: resp.otpauthUrl,
          message: resp.message,
        });
        setMfaRequired(false);
        message.info('请先绑定管理员 MFA，再输入验证码完成登录');
        return;
      }
      if (resp?.mfaRequired) {
        setMfaRequired(true);
        setMfaSetup(null);
        message.info(resp.message || '请输入 Google Authenticator 验证码');
        return;
      }
      navigate('/', { replace: true });
    } catch (err: unknown) {
      message.error((err as ApiError)?.response?.data?.message || (err as ApiError)?.message || '登录失败');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSsoLogin = async () => {
    if (!config) return;
    try {
      const url = `/api/auth/keycloak/login?redirectUri=${encodeURIComponent(config.redirectUri)}`;
      window.location.href = url;
    } catch (err: unknown) {
      message.error((err as ApiError)?.message || 'SSO 登录失败');
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
                onChange={() => {
                  setMfaRequired(false);
                  setMfaSetup(null);
                }}
              />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                autoComplete="current-password"
                onPressEnter={() => !loggingIn && form.submit()}
                onChange={() => {
                  setMfaRequired(false);
                  setMfaSetup(null);
                }}
              />
            </Form.Item>

            {mfaSetup && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={mfaSetup.message || '管理员账号需要绑定 MFA'}
                description={
                  <div>
                    <Paragraph style={{ marginBottom: 8 }}>
                      使用 Google Authenticator / Authy 扫描二维码，然后输入 6 位验证码完成绑定。
                    </Paragraph>
                    {mfaSetup.qrCodeDataUrl && (
                      <div style={{ textAlign: 'center', marginBottom: 8 }}>
                        <img src={mfaSetup.qrCodeDataUrl} alt="Admin MFA QR Code" style={{ width: 180, height: 180 }} />
                      </div>
                    )}
                    <Paragraph copyable style={{ marginBottom: 0 }}>
                      {mfaSetup.secret}
                    </Paragraph>
                  </div>
                }
              />
            )}

            {(mfaRequired || mfaSetup) && (
              <Form.Item
                name="otpCode"
                label="Google 验证码"
                rules={[{ required: true, message: '请输入 6 位验证码' }]}
              >
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  onPressEnter={() => !loggingIn && form.submit()}
                />
              </Form.Item>
            )}

            <Button type="default" block htmlType="submit" loading={loggingIn}>
              {mfaSetup ? '绑定并登录' : mfaRequired ? '验证并登录' : '管理员登录'}
            </Button>
          </Form>
        )}

        <div style={{ marginTop: 16, color: '#999' }}>© 2026 运维平台 · Powered by mgbx</div>
      </Card>
    </div>
  );
};

export default LoginPage;
