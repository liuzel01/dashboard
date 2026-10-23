import React, { useEffect, useState } from 'react';
import { Form } from 'antd';
import MfaCodeInput from './MfaCodeInput';
import { MFA_CODE_PATTERN } from './mfa';
import RiskConfirm from './RiskConfirm';
import type { RiskConfirmProps } from './RiskConfirm';

type MfaRiskConfirmProps = Omit<
  RiskConfirmProps,
  'children' | 'confirmLoading' | 'onOk' | 'onCancel' | 'open'
> & {
  open: boolean;
  children?: React.ReactNode;
  onCancel: () => void;
  onConfirm: (mfaCode: string) => Promise<void>;
};

const MfaRiskConfirm: React.FC<MfaRiskConfirmProps> = ({
  open,
  children,
  onCancel,
  onConfirm,
  okButtonProps,
  ...confirmProps
}) => {
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setMfaCode('');
      setSubmitting(false);
    }
  }, [open]);

  const confirm = async () => {
    if (!MFA_CODE_PATTERN.test(mfaCode)) return;
    setSubmitting(true);
    try {
      await onConfirm(mfaCode);
    } catch {
      // The business callback owns the user-facing error message. Keep the
      // confirmation open so the user can correct the code and retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RiskConfirm
      {...confirmProps}
      open={open}
      confirmLoading={submitting}
      okButtonProps={{
        ...okButtonProps,
        disabled: submitting || !MFA_CODE_PATTERN.test(mfaCode) || okButtonProps?.disabled,
      }}
      onCancel={onCancel}
      onOk={() => void confirm()}
    >
      {children}
      <Form.Item label="Google 验证码" required style={{ marginTop: 16, marginBottom: 0 }}>
        <MfaCodeInput value={mfaCode} onChange={setMfaCode} autoFocus />
      </Form.Item>
    </RiskConfirm>
  );
};

export default MfaRiskConfirm;
