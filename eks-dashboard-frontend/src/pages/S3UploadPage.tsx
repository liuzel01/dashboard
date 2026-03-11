import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Space, Upload, message, Progress } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { UploadOutlined, ReloadOutlined } from '@ant-design/icons';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import { checkS3ObjectExists, getS3Buckets, getEnvironmentConfigs, uploadS3Object } from '../services/api';

type BucketResponse = {
  region: string;
  buckets: string[];
};

const S3UploadPage: React.FC = () => {
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [form] = Form.useForm();
  const [buckets, setBuckets] = useState<string[]>([]);
  const [region, setRegion] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    bucket: string;
    key: string;
    file: File;
  } | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const envId = currentEnvironment?.id;

  const fetchRegionFromConfigs = async () => {
    if (!envId) return;
    const list = await getEnvironmentConfigs();
    const match = list.find((e: any) => e.id === envId);
    setRegion(match?.aws_region || '');
  };

  const fetchBuckets = async () => {
    if (!envId) return;
    setLoading(true);
    try {
      const data: BucketResponse = await getS3Buckets();
      setBuckets(data.buckets || []);
      setRegion(data.region || '');
    } catch (e: any) {
      message.error(getErrorMessage(e) || '加载桶列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    form.resetFields(['bucket']);
    setBuckets([]);
    setRegion('');
    setFileList([]);
    fetchBuckets();
    fetchRegionFromConfigs();
  }, [envId]);

  const doUpload = async (bucket: string, key: string, file: File) => {
    setProgress(0);
    await uploadS3Object(bucket, key, file, (p) => setProgress(p));
    const url = region
      ? `https://${bucket}.s3.${region}.amazonaws.com/${key}`
      : `https://${bucket}.s3.amazonaws.com/${key}`;
    message.success(`上传成功: ${url}`);
    setLastUrl(url);
    setFileList([]);
    // keep key value as-is for convenience
  };

  const onUpload = async () => {
    const values = await form.validateFields();
    if (!envId) {
      message.error('请先选择环境');
      return;
    }
    if (fileList.length === 0 || !fileList[0].originFileObj) {
      message.error('请选择要上传的文件');
      return;
    }
    const file = fileList[0].originFileObj as File;
    const bucket = values.bucket;
    const rawKey = values.key as string;
    const key = rawKey.endsWith('/') && file?.name ? `${rawKey}${file.name}` : rawKey;

    try {
      setLoading(true);
      const existsResp = await checkS3ObjectExists(bucket, key);
      if (existsResp.exists) {
        setLoading(false);
        setPendingUpload({ bucket, key, file });
        setConfirmOpen(true);
        return;
      }
      await doUpload(bucket, key, file);
    } catch (e: any) {
      message.error(getErrorMessage(e) || '上传失败');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const getErrorMessage = (e: any) => {
    if (!e) return '';
    const respMsg = e?.response?.data?.message;
    if (Array.isArray(respMsg)) return respMsg.join('; ');
    if (respMsg) return String(respMsg);
    return e?.message ? String(e.message) : '';
  };

  const bucketOptions = useMemo(
    () => buckets.map((b) => ({ label: b, value: b })),
    [buckets],
  );

  return (
    <>
      {!envId && <Alert type="warning" message="请先在右上角选择环境" showIcon style={{ marginBottom: 16 }} />}
      {lastUrl && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="对象 URL"
          description={lastUrl}
        />
      )}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchBuckets} disabled={!envId || loading}>
          刷新桶列表
        </Button>
      </Space>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ key: 'json/' }}
        style={{ maxWidth: 720 }}
      >
        <Form.Item label="当前环境" style={{ marginBottom: 8 }}>
          <Input value={envId || ''} disabled />
        </Form.Item>
        <Form.Item label="Region" style={{ marginBottom: 16 }}>
          <Input value={region || ''} disabled />
        </Form.Item>
        <Form.Item
          label="Bucket"
          name="bucket"
          rules={[{ required: true, message: '请选择桶' }]}
        >
          <Select
            placeholder="选择 S3 Bucket"
            options={bucketOptions}
            loading={loading}
            showSearch
            filterOption={(input, option) =>
              (option?.value as string).toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item
          label="Key（对象路径）"
          name="key"
          rules={[{ required: true, message: '请输入对象 Key' }]}
          extra="支持自定义路径，例如：json/test-txt.json；如果以 / 结尾，将自动拼接文件名"
        >
          <Input />
        </Form.Item>
        <Form.Item label="选择文件" required>
          <Upload
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: list }) => setFileList(list.slice(-1))}
          >
            <Button icon={<UploadOutlined />}>选择文件</Button>
          </Upload>
        </Form.Item>
        {progress !== null && <Progress percent={progress} style={{ marginBottom: 16 }} />}
        <Button type="primary" onClick={onUpload} loading={loading} disabled={!envId}>
          上传到 S3
        </Button>
      </Form>

      <Modal
        title="文件已存在"
        open={confirmOpen}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingUpload(null);
        }}
        okText="覆盖"
        cancelText="取消"
        onOk={async () => {
          if (!pendingUpload) return;
          try {
            setConfirmOpen(false);
            setLoading(true);
            await doUpload(pendingUpload.bucket, pendingUpload.key, pendingUpload.file);
          } catch (e: any) {
            message.error(getErrorMessage(e) || '上传失败');
          } finally {
            setLoading(false);
            setProgress(null);
            setPendingUpload(null);
          }
        }}
      >
        <div>该路径下已有同名文件，是否覆盖？</div>
        <div style={{ marginTop: 8, color: '#555' }}>{pendingUpload?.key}</div>
      </Modal>
    </>
  );
};

export default S3UploadPage;
