import React, { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Collapse, Form, Input, Row, Select, Space, Table, Tooltip, Typography } from 'antd';
import { CopyOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { decryptKmsValue, encryptKmsValue, getEnvironmentConfigs, getKmsValueConfiguration } from '../services/api';

const { Text } = Typography;
type Env = { id: string; name: string; aws_region?: string };
type KmsConfigField = { key: string; field: string; value: string };

const KmsValuesPage: React.FC = () => {
  const { message } = App.useApp();
  const [envs, setEnvs] = useState<Env[]>([]);
  const [environmentId, setEnvironmentId] = useState('hashex');
  const [encrypting, setEncrypting] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [encrypted, setEncrypted] = useState('');
  const [decrypted, setDecrypted] = useState('');
  const [kmsConfiguration, setKmsConfiguration] = useState<Awaited<ReturnType<typeof getKmsValueConfiguration>> | null>(null);
  const [encryptForm] = Form.useForm();
  const [decryptForm] = Form.useForm();
  useEffect(() => { getEnvironmentConfigs().then((x) => setEnvs(Array.isArray(x) ? x : [])).catch(() => message.error('环境列表加载失败')); }, [message]);
  useEffect(() => {
    setKmsConfiguration(null);
    getKmsValueConfiguration(environmentId).then(setKmsConfiguration).catch((e: any) => message.error(e?.response?.data?.message || 'KMS 配置加载失败'));
  }, [environmentId, message]);
  const copy = async (value: string) => {
    if (!window.isSecureContext || !navigator.clipboard?.writeText) {
      message.warning('复制功能仅支持 HTTPS 页面，请通过 HTTPS 访问后重试。');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      message.success('已复制');
    } catch {
      message.error('复制失败，请检查浏览器的剪贴板权限。');
    }
  };
  const kmsConfigColumns = [
    { title: '字段', dataIndex: 'field', key: 'field', width: 240 },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (value: string) => (
        <Tooltip title={value} placement="topLeft">
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <Text code>{value}</Text>
          </div>
        </Tooltip>
      ),
    },
  ];
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Space><Text strong>AWS 环境</Text><Select showSearch optionFilterProp="label" value={environmentId} onChange={(value) => { setEnvironmentId(value); setEncrypted(''); setDecrypted(''); }} style={{ width: 300 }} placeholder="输入环境名称或 ID 匹配" options={envs.map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))} /></Space>
    {kmsConfiguration && (kmsConfiguration.supported ? <Collapse items={[{
      key: 'kms-config',
      label: '当前 KMS 配置（只读）',
      children: <Table<KmsConfigField>
        rowKey="key"
        size="middle"
        pagination={false}
        columns={kmsConfigColumns}
        dataSource={[
          { key: 'alias', field: 'KMS_KEY_ALIAS', value: String(kmsConfiguration.keyAlias || '') },
          { key: 'region', field: 'AWS_REGION', value: String(kmsConfiguration.region || '') },
          { key: 'arn', field: 'KMS_KEY_ARN', value: String(kmsConfiguration.keyArn || '') },
          { key: 'prefix', field: '密文前缀', value: String(kmsConfiguration.ciphertextPrefix || '') },
          { key: 'context', field: 'KMS_CONTEXT', value: JSON.stringify(kmsConfiguration.encryptionContext) },
          { key: 'role', field: 'Target Role', value: kmsConfiguration.targetRoleConfigured ? '已配置' : '未配置' },
        ]}
      />,
    }]} /> : <Alert type="info" showIcon message="此环境暂未启用 KMS 变量值加解密" description={kmsConfiguration.reason} />)}
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
