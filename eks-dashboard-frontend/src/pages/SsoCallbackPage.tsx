import React, { useEffect, useRef, useState } from 'react';
import { Spin, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContextValue';

const { Text } = Typography;

const SsoCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { applyToken } = React.useContext(AuthContext);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // AuthProvider updates during applyToken can recreate this component's
    // context callback. Guard the whole flow so a second effect invocation
    // cannot inspect the URL after navigation and show a false error.
    if (startedRef.current) return;
    startedRef.current = true;

    const run = async () => {
      try {
        let token: string | null = null;
        let hashError: string | null = null;
        // A redirect can briefly render the callback document before the
        // browser exposes its fragment. Retry briefly before reporting an
        // error so a successful SSO flow does not flash a false warning.
        for (const delayMs of [0, 100, 300]) {
          if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          token = hashParams.get('token');
          hashError = hashParams.get('error');
          if (token || hashError) break;
        }
        if (hashError) throw new Error(hashError);
        if (!token) {
          // This also covers a duplicate callback invocation after the first
          // invocation has already persisted the token and navigated away.
          const storedToken = localStorage.getItem('authToken');
          if (storedToken) {
            navigate('/', { replace: true });
            return;
          }
          throw new Error('缺少登录令牌');
        }
        await applyToken(token);
        // Do not leave a bearer token in browser history or copied URLs.
        window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
        navigate('/', { replace: true });
      } catch (err: unknown) {
        const msg = (err as ApiError)?.message || 'SSO 登录失败';
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
