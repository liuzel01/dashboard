import React from 'react';
import { Input, Typography } from 'antd';
import type { InputProps } from 'antd';
import { normalizeMfaCode } from './mfa';

type MfaCodeInputProps = Omit<InputProps, 'onChange' | 'value'> & {
  value?: string;
  onChange?: (value: string) => void;
  showGraceHint?: boolean;
};

const MfaCodeInput: React.FC<MfaCodeInputProps> = ({
  value,
  onChange,
  showGraceHint = true,
  placeholder = '输入当前 Google Authenticator 6 位验证码',
  ...inputProps
}) => (
  <div>
    <Input.Password
      {...inputProps}
      value={value}
      maxLength={6}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder={placeholder}
      onChange={(event) => onChange?.(normalizeMfaCode(event.target.value))}
    />
    {showGraceHint && (
      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
        当前验证码或刚更新的上一枚验证码均可使用。
      </Typography.Text>
    )}
  </div>
);

export default MfaCodeInput;
