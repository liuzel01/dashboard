import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Form, Input, Row, Select, Space, Typography } from 'antd';
import { CopyOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { decryptKmsValue, encryptKmsValue, getEnvironmentConfigs } from '../services/api';

const { Text } = Typography;
type Env = { id: string; name: string; aws_region?: string };

const KmsValuesPage: React.FC = () => {
  const { message } = App.useApp();
  const [envs, setEnvs] = useState<Env[]>([]);
  const [environmentId, setEnvironmentId] = useState('hashex');
  const [encrypting, setEncrypting] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [encrypted, setEncrypted] = useState('');
  const [decrypted, setDecrypted] = useState('');
  const [encryptForm] = Form.useForm();
  const [decryptForm] = Form.useForm();
  useEffect(() => { getEnvironmentConfigs().then((x) => setEnvs(Array.isArray(x) ? x : [])).catch(() => message.error('环境列表加载失败')); }, [message]);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); message.success('已复制'); } catch { message.error('复制失败，请手动复制'); } };
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Alert type="warning" showIcon message="仅处理单个变量值" description="当前仅支持 hashex 的 alias/kms-eks-hash。输入不会保存，审计日志仅记录输入摘要；解密必须验证 Google Authenticator MFA。" />
    <Space><Text strong>AWS 环境</Text><Select value={environmentId} onChange={setEnvironmentId} style={{ width: 260 }} options={envs.map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))} /></Space>
    <Row gutter={16}>
      <Col xs={24} lg={12}><Card title="加密变量值" extra={<LockOutlined />}>
        <Form form={encryptForm} layout="vertical" onFinish={async (v) => { setEncrypting(true); try { const r = await encryptKmsValue({ environmentId, value: v.value }); setEncrypted(r.value); message.success('KMS 加密成功'); } catch (e: any) { message.error(e?.response?.data?.message || e?.message || '加密失败'); } finally { setEncrypting(false); } }}>
          <Form.Item name="value" label="明文变量值" rules={[{ required: true, message: '请输入变量值' }]}><Input.TextArea rows={8} autoComplete="off" /></Form.Item>
          <Button htmlType="submit" type="primary" loading={encrypting}>加密</Button>
        </Form>
        {encrypted && <><Text strong style={{ display: 'block', marginTop: 16 }}>加密结果</Text><Input.TextArea value={encrypted} readOnly rows={6} /><Button icon={<CopyOutlined />} style={{ marginTop: 8 }} onClick={() => copy(encrypted)}>复制密文</Button></>}
      </Card></Col>
      <Col xs={24} lg={12}><Card title="解密变量值" extra={<UnlockOutlined />}>
        <Form form={decryptForm} layout="vertical" onFinish={async (v) => { setDecrypting(true); try { const r = await decryptKmsValue({ environmentId, value: v.value, otpCode: v.otpCode }); setDecrypted(r.value); message.success('KMS 解密成功'); } catch (e: any) { message.error(e?.response?.data?.message || e?.message || '解密失败'); } finally { setDecrypting(false); } }}>
          <Form.Item name="value" label="{kms-app} 密文" rules={[{ required: true, message: '请输入密文' }]}><Input.TextArea rows={6} autoComplete="off" /></Form.Item>
          <Form.Item name="otpCode" label="Google 验证码" rules={[{ required: true, message: '请输入验证码' }]}><Input.Password maxLength={12} autoComplete="one-time-code" /></Form.Item>
          <Button htmlType="submit" danger loading={decrypting}>验证 MFA 并解密</Button>
        </Form>
        {decrypted && <><Text strong style={{ display: 'block', marginTop: 16 }}>解密结果（请及时复制并清除）</Text><Input.TextArea value={decrypted} readOnly rows={4} /><Button icon={<CopyOutlined />} style={{ marginTop: 8 }} onClick={() => copy(decrypted)}>复制明文</Button></>}
      </Card></Col>
    </Row>
  </Space>;
};
export default KmsValuesPage;
