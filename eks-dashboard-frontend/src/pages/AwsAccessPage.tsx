import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { LoginOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { AuthContext } from "../contexts/AuthContextValue";
import { OpsTable, PageHeader } from "../components/ops";
import {
  createAwsAccessGrant,
  getAccessUsers,
  getAwsAccessConfiguration,
  launchAwsAccessSession,
  listAwsAccessGrants,
  revokeAwsAccessGrant,
  type AwsAccessGrant,
} from "../services/api";
import { formatDateTime } from "../utils/time";

const errorText = (error: unknown, fallback: string) => {
  const candidate = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return candidate?.response?.data?.message || candidate?.message || fallback;
};

export default function AwsAccessPage() {
  const { permissions } = useContext(AuthContext);
  const canManage = permissions.includes("aws-access:grant:manage");
  const canStart = permissions.includes("aws-access:session:start");
  const [configuration, setConfiguration] = useState<Awaited<
    ReturnType<typeof getAwsAccessConfiguration>
  > | null>(null);
  const [grants, setGrants] = useState<AwsAccessGrant[]>([]);
  const [users, setUsers] = useState<
    Array<{
      id: number;
      username: string;
      display_name?: string;
      status?: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<number>();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeGrant, setRevokeGrant] = useState<AwsAccessGrant>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [revokeForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [config, items] = await Promise.all([
        getAwsAccessConfiguration(),
        listAwsAccessGrants(),
      ]);
      setConfiguration(config);
      setGrants(items);
      if (config.canManage) setUsers(await getAccessUsers());
    } catch (error) {
      message.error(errorText(error, "加载 AWS 临时访问失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const userOptions = useMemo(
    () =>
      users
        .filter((user) => user.status === "active")
        .map((user) => ({
          value: user.id,
          label: `${user.display_name || user.username}（${user.username}）`,
        })),
    [users],
  );

  const launch = async (grant: AwsAccessGrant) => {
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setLaunching(grant.id);
    try {
      const result = await launchAwsAccessSession(grant.id);
      if (popup) popup.location.href = result.redirectUrl;
      else window.location.assign(result.redirectUrl);
      message.success("AWS 只读会话已签发");
      await load();
    } catch (error) {
      popup?.close();
      message.error(errorText(error, "启动 AWS 临时会话失败"));
    } finally {
      setLaunching(undefined);
    }
  };

  const columns = [
    {
      title: "运维系统用户",
      render: (_: unknown, row: AwsAccessGrant) => (
        <>
          <div>{row.display_name || row.username}</div>
          <Typography.Text type="secondary">{row.username}</Typography.Text>
        </>
      ),
    },
    {
      title: "环境 / 权限",
      render: (_: unknown, row: AwsAccessGrant) => (
        <Space direction="vertical" size={2}>
          <Tag>{row.environment_id}</Tag>
          <span>
            {row.permission_template_key === "HUMAN_READ"
              ? "Human Read（只读）"
              : row.permission_template_key}
          </span>
        </Space>
      ),
    },
    {
      title: "区域",
      dataIndex: "regions",
      render: (regions: string[]) =>
        regions.map((region) => <Tag key={region}>{region}</Tag>),
    },
    {
      title: "有效期",
      render: (_: unknown, row: AwsAccessGrant) => (
        <Space direction="vertical" size={2}>
          <span>{formatDateTime(row.valid_until)}</span>
          <Tag
            color={
              row.status === "ACTIVE"
                ? "green"
                : row.status === "EXPIRED"
                  ? "orange"
                  : "red"
            }
          >
            {row.status === "ACTIVE"
              ? "生效中"
              : row.status === "EXPIRED"
                ? "已到期"
                : "已回收"}
          </Tag>
        </Space>
      ),
    },
    { title: "原因", dataIndex: "reason", ellipsis: true },
    {
      title: "会话",
      render: (_: unknown, row: AwsAccessGrant) => `${row.session_count} 次`,
    },
    {
      title: "操作",
      render: (_: unknown, row: AwsAccessGrant) => (
        <Space>
          {canStart && row.status === "ACTIVE" && (
            <Button
              type="primary"
              icon={<LoginOutlined />}
              loading={launching === row.id}
              onClick={() => void launch(row)}
            >
              进入 AWS
            </Button>
          )}
          {canManage && row.status === "ACTIVE" && (
            <Button
              danger
              onClick={() => {
                setRevokeGrant(row);
                revokeForm.resetFields();
              }}
            >
              提前回收
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="AWS 临时访问"
        description="管理员向用户授予有时限的 hashex AWS 只读权限；AWS 临时凭据不会进入浏览器或数据库。"
        actions={
          canManage ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  permissionTemplateKey: "HUMAN_READ",
                  regions: configuration?.regions,
                  validUntil: dayjs().add(1, "hour"),
                });
                setCreateOpen(true);
              }}
            >
              新增临时授权
            </Button>
          ) : undefined
        }
      />
      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="安全边界"
        description="当前仅开放 Human Read（AWS ViewOnlyAccess）。一次性 ticket 仅可消费一次，到期后服务端立即拒绝新会话；已签发 STS 会话不会晚于授权到期时间。"
      />
      {!configuration?.enabled && !loading && (
        <Alert type="warning" showIcon message="hashex AWS 临时访问尚未启用" />
      )}
      <OpsTable
        rowKey="id"
        loading={loading}
        dataSource={grants}
        columns={columns}
      />

      <Modal
        title="新增 AWS 临时授权"
        open={createOpen}
        confirmLoading={saving}
        okText="验证 MFA 并授权"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSaving(true);
            try {
              await createAwsAccessGrant({
                ...values,
                cloudAccountId: configuration!.account.id,
                validUntil: values.validUntil.toISOString(),
              });
              message.success("AWS 临时授权已创建");
              setCreateOpen(false);
              await load();
            } catch (error) {
              message.error(errorText(error, "创建授权失败"));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item
            name="granteeUserId"
            label="运维系统用户"
            rules={[{ required: true }]}
          >
            <Select showSearch optionFilterProp="label" options={userOptions} />
          </Form.Item>
          <Form.Item
            name="permissionTemplateKey"
            label="权限模板"
            rules={[{ required: true }]}
          >
            <Select
              options={configuration?.templates.map((item) => ({
                value: item.key,
                label: item.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="regions"
            label="允许区域"
            rules={[{ required: true }]}
          >
            <Select
              mode="multiple"
              options={configuration?.regions.map((region) => ({
                value: region,
                label: region,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="validUntil"
            label="到期时间"
            rules={[{ required: true }]}
          >
            <DatePicker
              showTime
              style={{ width: "100%" }}
              disabledDate={(date) => date.isBefore(dayjs(), "day")}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="授权原因"
            rules={[{ required: true }]}
          >
            <Input.TextArea maxLength={1000} showCount />
          </Form.Item>
          <Form.Item
            name="mfaCode"
            label="当前管理员 Google 验证码"
            rules={[
              {
                required: true,
                pattern: /^\d{6}$/,
                message: "请输入 6 位验证码",
              },
            ]}
          >
            <Input.Password
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="提前回收 AWS 临时授权"
        open={Boolean(revokeGrant)}
        confirmLoading={saving}
        okButtonProps={{ danger: true }}
        okText="验证 MFA 并回收"
        onCancel={() => setRevokeGrant(undefined)}
        onOk={() => revokeForm.submit()}
      >
        <Form
          form={revokeForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!revokeGrant) return;
            setSaving(true);
            try {
              await revokeAwsAccessGrant(revokeGrant.id, values);
              message.success("授权已提前回收");
              setRevokeGrant(undefined);
              await load();
            } catch (error) {
              message.error(errorText(error, "回收授权失败"));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item
            name="reason"
            label="回收原因"
            rules={[{ required: true }]}
          >
            <Input.TextArea maxLength={1000} />
          </Form.Item>
          <Form.Item
            name="mfaCode"
            label="当前管理员 Google 验证码"
            rules={[
              {
                required: true,
                pattern: /^\d{6}$/,
                message: "请输入 6 位验证码",
              },
            ]}
          >
            <Input.Password
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
