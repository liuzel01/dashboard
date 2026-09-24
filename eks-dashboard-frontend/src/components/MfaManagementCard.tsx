import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Space, Tag, Typography, message } from 'antd';
import {
  confirmMyMfaEnrollment,
  disableMyMfa,
  getMyMfaStatus,
  startMyMfaEnrollment,
  type MfaStatus,
} from '../services/api';

const { Text } = Typography;

type MfaEnrollment = {
  secret: string;
  qrCodeDataUrl: string;
};

const MfaManagementCard: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<MfaEnrollment | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaConfirming, setMfaConfirming] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaDisableModalOpen, setMfaDisableModalOpen] = useState(false);
  const [mfaDisableCode, setMfaDisableCode] = useState('');

  const refreshMfaStatus = async () => {
    try {
      setMfaStatus(await getMyMfaStatus());
    } catch (e: any) {
      message.error(e?.message || '加载 MFA 状态失败');
    }
  };

  useEffect(() => {
    refreshMfaStatus();
  }, []);

  const handleStartMfaEnrollment = async () => {
    try {
      setMfaLoading(true);
      const enrollment = await startMyMfaEnrollment();
      setMfaEnrollment(enrollment);
      setMfaCode('');
      await refreshMfaStatus();
      message.success('MFA 绑定信息已生成，请使用 Google Authenticator 扫码');
    } catch (e: any) {
      message.error(e?.message || '生成 MFA 绑定信息失败');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleConfirmMfaEnrollment = async () => {
    if (!/^\d{6}$/.test(mfaCode)) {
      message.error('请输入当前 Google Authenticator 的 6 位验证码');
      return;
    }
    try {
      setMfaConfirming(true);
      setMfaStatus(await confirmMyMfaEnrollment(mfaCode));
      setMfaEnrollment(null);
      setMfaCode('');
      message.success('MFA 已绑定到当前账号');
    } catch (e: any) {
      message.error(e?.message || 'MFA 验证失败');
    } finally {
      setMfaConfirming(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!/^\d{6}$/.test(mfaDisableCode)) {
      message.error('请输入当前 Google Authenticator 的 6 位验证码');
      return;
    }
    try {
      setMfaConfirming(true);
      setMfaStatus(await disableMyMfa(mfaDisableCode));
      setMfaDisableModalOpen(false);
      setMfaDisableCode('');
      message.success('当前账号的 MFA 已解除');
    } catch (e: any) {
      message.error(e?.message || '解除 MFA 失败');
    } finally {
      setMfaConfirming(false);
    }
  };

  return (
    <Card
      title="账号安全 / MFA 管理"
      size="small"
      style={style}
      extra={
        mfaStatus ? (
          <Tag color={mfaStatus.enabled ? 'green' : 'default'}>
            {mfaStatus.enabled ? '已绑定' : '未绑定'}
          </Tag>
        ) : null
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Text type="secondary">
          MFA 只绑定当前登录账号。后续需要 MFA 的敏感操作必须使用当前账号自己的 Google Authenticator 验证码，不能使用其他账号的验证码。
        </Text>
        {mfaStatus?.enabled ? (
          <Space wrap>
            <Text>当前账号已启用 Google Authenticator MFA</Text>
            <Button danger onClick={() => { setMfaDisableCode(''); setMfaDisableModalOpen(true); }}>
              解除 MFA
            </Button>
          </Space>
        ) : (
          <>
            <Button type="primary" loading={mfaLoading} onClick={handleStartMfaEnrollment}>
              {mfaStatus?.enrollmentPending ? '重新生成绑定信息' : '开始绑定 Google Authenticator'}
            </Button>
            {mfaEnrollment && (
              <Card size="small" type="inner" title="绑定步骤">
                <Space direction="vertical" size="small">
                  <Text>使用 Google Authenticator 扫描二维码，然后输入当前显示的 6 位验证码确认绑定。</Text>
                  <img src={mfaEnrollment.qrCodeDataUrl} alt="Google Authenticator MFA 二维码" style={{ width: 180, height: 180 }} />
                  <Text copyable={{ text: mfaEnrollment.secret }}>
                    手动设置密钥：{mfaEnrollment.secret}
                  </Text>
                  <Space.Compact>
                    <Input
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="输入 6 位验证码"
                      maxLength={6}
                      inputMode="numeric"
                    />
                    <Button type="primary" loading={mfaConfirming} onClick={handleConfirmMfaEnrollment}>
                      确认绑定
                    </Button>
                  </Space.Compact>
                </Space>
              </Card>
            )}
          </>
        )}
      </Space>

      <Modal
        title="解除当前账号的 MFA"
        open={mfaDisableModalOpen}
        onCancel={() => setMfaDisableModalOpen(false)}
        onOk={handleDisableMfa}
        confirmLoading={mfaConfirming}
        okText="确认解除"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="解除后，当前账号将不再要求 MFA。"
          style={{ marginBottom: 16 }}
        />
        <Input
          value={mfaDisableCode}
          onChange={(event) => setMfaDisableCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="输入当前 Google Authenticator 的 6 位验证码"
          maxLength={6}
          inputMode="numeric"
        />
      </Modal>
    </Card>
  );
};

export default MfaManagementCard;
