import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { InlineHelpTooltip } from "../components/ops";
import { AuthContext } from "../contexts/AuthContextValue";
import { EnvironmentContext } from "../contexts/EnvironmentContextValue";
import { BytebaseRealtimeContext } from "../contexts/BytebaseRealtimeContextValue";
import {
  createBytebaseChange,
  diagnoseBytebase,
  executeBytebaseRollout,
  getBytebaseCatalog,
  getBytebaseDatabases,
  listBytebaseRequests,
  type BytebaseDatabase,
  type BytebaseProject,
  type BytebaseRequest,
} from "../services/api";

const errorText = (e: unknown, fallback: string) =>
  (e as ApiError)?.response?.data?.message || (e as Error)?.message || fallback;
type Diagnostic = {
  ok?: boolean;
  version?: string;
  latencyMs?: number;
  jit?: string;
  jitReason?: string;
};
type ChangeForm = {
  database: string;
  title: string;
  description?: string;
  statement: string;
};
const BytebaseCenterPage: React.FC = () => {
  const { message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const { permissions } = useContext(AuthContext);
  const { socket, connected: realtimeConnected } = useContext(
    BytebaseRealtimeContext,
  );
  const [projects, setProjects] = useState<BytebaseProject[]>([]),
    [databases, setDatabases] = useState<BytebaseDatabase[]>([]),
    [requests, setRequests] = useState<BytebaseRequest[]>([]);
  const [project, setProject] = useState<string>(),
    [loading, setLoading] = useState(false),
    [diagnostic, setDiagnostic] = useState<Diagnostic>();
  const [form] = Form.useForm();
  const env = currentEnvironment?.id;
  const canSubmit = permissions.includes("bytebase:change:submit"),
    canRollout = permissions.includes("bytebase:rollout:execute"),
    canDiagnose = permissions.includes("bytebase:config:manage");
  const load = useCallback(async () => {
    if (!env) return;
    setLoading(true);
    try {
      const [catalog, runs] = await Promise.all([
        getBytebaseCatalog(env),
        listBytebaseRequests(),
      ]);
      setProjects(catalog.projects);
      setRequests(runs);
      if (!catalog.jit.supported)
        setDiagnostic((v) => ({ ...v, jitReason: catalog.jit.reason }));
    } catch (e) {
      message.error(errorText(e, "Bytebase 目录加载失败"));
    } finally {
      setLoading(false);
    }
  }, [env, message]);
  useEffect(() => {
    setProject(undefined);
    setDatabases([]);
    void load();
  }, [env, load]);
  useEffect(() => {
    if (!socket) return;
    const refresh = () => void load();
    socket.on("bytebase-request-updated", refresh);
    return () => {
      socket.off("bytebase-request-updated", refresh);
    };
  }, [socket, load]);
  useEffect(() => {
    if (!env || !project) {
      setDatabases([]);
      return;
    }
    getBytebaseDatabases(env, project)
      .then((x) => setDatabases(x.databases || []))
      .catch((e) => message.error(errorText(e, "数据库目录加载失败")));
  }, [env, project, message]);
  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.name,
        label: p.title ? `${p.title}（${p.name}）` : p.name,
      })),
    [projects],
  );
  const databaseOptions = useMemo(
    () =>
      databases.map((d) => ({
        value: d.name,
        label: d.databaseName ? `${d.databaseName}（${d.name}）` : d.name,
      })),
    [databases],
  );
  const submit = async (values: ChangeForm) => {
    if (!env || !project) return;
    setLoading(true);
    try {
      await createBytebaseChange({ ...values, environmentId: env, project });
      message.success(
        "已创建 Bytebase Draft Issue，并启动 Plan Check；等待管理员确认发布",
      );
      form.resetFields(["title", "description", "statement"]);
      await load();
    } catch (e) {
      message.error(errorText(e, "创建变更失败"));
    } finally {
      setLoading(false);
    }
  };
  const rollout = (row: BytebaseRequest) => {
    let code = "";
    Modal.confirm({
      title: "确认执行 Bytebase 发布",
      icon: <SafetyCertificateOutlined />,
      content: (
        <Input.Password
          placeholder="Google Authenticator 验证码"
          onChange={(e) => {
            code = e.target.value;
          }}
        />
      ),
      okText: "确认发布",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!row.plan_name) throw new Error("申请缺少 Plan");
        try {
          await executeBytebaseRollout(row.environment_id, row.plan_name, code);
          message.success("发布已确认，Bytebase 正在创建并执行 Rollout");
          await load();
        } catch (e) {
          message.error(errorText(e, "发布失败"));
          throw e;
        }
      },
    });
  };
  if (!env) return <Alert type="warning" showIcon message="请先选择目标环境" />;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        <Space size={6} align="center">
          <span>数据库访问与变更中心</span>
          <InlineHelpTooltip
            ariaLabel="数据库访问与变更说明"
            content={`Dashboard 负责统一授权与审计；数据库变更由 Bytebase Issue / Plan / Rollout 执行。当前实时状态：${realtimeConnected ? "已连接" : "连接中或不可用"}。`}
          />
        </Space>
      </Typography.Title>
      <Card>
        <Space wrap>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 420 }}
            placeholder="选择 Bytebase 项目"
            value={project}
            options={projectOptions}
            onChange={setProject}
          />
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
          >
            刷新目录
          </Button>
          {canDiagnose && (
            <Button
              onClick={async () => {
                try {
                  setDiagnostic(await diagnoseBytebase(env));
                  message.success("连接诊断完成");
                } catch (e) {
                  message.error(errorText(e, "连接诊断失败"));
                }
              }}
            >
              连接诊断
            </Button>
          )}
        </Space>
        {diagnostic && (
          <Collapse
            style={{ marginTop: 12 }}
            items={[{
              key: "bytebase-runtime-status",
              label: <Space size={6}><Typography.Text strong>Bytebase 运行状态</Typography.Text><Tag color={diagnostic.ok ? "success" : "warning"}>{diagnostic.ok ? "连接正常" : "JIT 当前不可用"}</Tag></Space>,
              children: <Alert
                type={diagnostic.ok ? "success" : "warning"}
                showIcon
                message={diagnostic.ok ? `Bytebase ${diagnostic.version || ""} 连接正常` : "JIT 当前不可用"}
                description={diagnostic.jitReason || `延迟 ${diagnostic.latencyMs || "-"}ms；JIT：${diagnostic.jit || "UNSUPPORTED"}`}
              />,
            }]}
          />
        )}
      </Card>
      <Tabs
        items={[
          {
            key: "catalog",
            label: "数据库目录",
            children: (
              <Table
                rowKey="name"
                loading={loading}
                dataSource={databases}
                pagination={{ pageSize: 20 }}
                columns={[
                  {
                    title: "数据库",
                    dataIndex: "databaseName",
                    render: (v, record) => v || record.name,
                  },
                  { title: "资源名", dataIndex: "name" },
                  {
                    title: "环境",
                    dataIndex: "effectiveEnvironment",
                    render: (v) => v || "-",
                  },
                ]}
              />
            ),
          },
          {
            key: "change",
            label: "变更申请",
            children: canSubmit ? (
              <Card>
                <Form form={form} layout="vertical" onFinish={submit}>
                  <Form.Item
                    label="目标数据库"
                    name="database"
                    rules={[{ required: true }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={databaseOptions}
                      disabled={!project}
                    />
                  </Form.Item>
                  <Form.Item
                    label="标题"
                    name="title"
                    rules={[{ required: true }]}
                  >
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item label="说明" name="description">
                    <Input.TextArea rows={2} />
                  </Form.Item>
                  <Form.Item
                    label="SQL"
                    name="statement"
                    rules={[{ required: true }]}
                  >
                    <Input.TextArea
                      rows={12}
                      placeholder="SQL 将提交给 Bytebase SQL Review，不会由 Dashboard 直连执行"
                    />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading}>
                    创建 Issue 并运行 Plan Check
                  </Button>
                </Form>
              </Card>
            ) : (
              <Alert
                type="warning"
                showIcon
                message="当前账号没有变更提交权限"
              />
            ),
          },
          {
            key: "requests",
            label: "申请记录",
            children: (
              <Table
                rowKey="request_id"
                dataSource={requests}
                pagination={{ pageSize: 20 }}
                scroll={{ x: 1200 }}
                columns={[
                  { title: "标题", dataIndex: "title", fixed: "left" },
                  { title: "环境", dataIndex: "environment_id" },
                  { title: "项目", dataIndex: "project_name" },
                  {
                    title: "数据库",
                    dataIndex: "database_name",
                    ellipsis: true,
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (v) => (
                      <Tag
                        color={
                          v === "SUCCEEDED"
                            ? "success"
                            : v === "FAILED" || v === "UNKNOWN"
                              ? "error"
                              : v === "ROLLOUT_RUNNING"
                                ? "processing"
                                : "default"
                        }
                      >
                        {v}
                      </Tag>
                    ),
                  },
                  { title: "提交人", dataIndex: "actor_username" },
                  { title: "Plan", dataIndex: "plan_name", ellipsis: true },
                  {
                    title: "远端状态",
                    render: (_, r) =>
                      [r.issue_status, r.approval_status, r.rollout_status]
                        .filter(Boolean)
                        .join(" / ") || "-",
                  },
                  {
                    title: "操作",
                    fixed: "right",
                    render: (_, r) =>
                      canRollout && r.plan_name ? (
                        <Button
                          danger
                          size="small"
                          disabled={r.status !== "AWAITING_ADMIN_CONFIRMATION"}
                          onClick={() => rollout(r)}
                        >
                          确认发布
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </Space>
  );
};
export default BytebaseCenterPage;
