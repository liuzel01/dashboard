import React, { useEffect, useState } from 'react';
import { Spin, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';

const { Text } = Typography;

const SsoCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { applyToken } = React.useContext(AuthContext);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hash);
        const token = hashParams.get('token');
        const hashError = hashParams.get('error');
        if (hashError) {
          throw new Error(hashError);
        }
        if (!token) {
          throw new Error('缺少登录令牌');
        }
        await applyToken(token);
        navigate('/', { replace: true });
      } catch (err: any) {
        const msg = err?.message || 'SSO 登录失败';
        setError(msg);
        message.error(msg);
      }
    };

    run();
  }, [applyToken, navigate]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa' }}>
      {error ? <Text type="danger">{error}</Text> : <Spin tip="正在完成登录..." />}
    </div>
  );
};

export default SsoCallbackPage;
