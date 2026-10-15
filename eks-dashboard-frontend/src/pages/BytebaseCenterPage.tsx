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
  Descriptions,
  Divider,
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
import { EyeOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import { InlineHelpTooltip } from "../components/ops";
import { AuthContext } from "../contexts/AuthContextValue";
import { EnvironmentContext } from "../contexts/EnvironmentContextValue";
import { BytebaseRealtimeContext } from "../contexts/BytebaseRealtimeContextValue";
import {
  cancelBytebaseRequest,
  createBytebaseChange,
  diagnoseBytebase,
  executeBytebaseRollout,
  getBytebaseCatalog,
  getBytebaseDatabases,
  getBytebaseRequestDetail,
  listBytebaseRequests,
  type BytebaseDatabase,
  type BytebaseProject,
  type BytebaseRequest,
  type BytebaseRequestDetail,
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
  const [detail, setDetail] = useState<BytebaseRequestDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
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
  const openDetail = async (row: BytebaseRequest) => {
    setDetailLoading(true);
    try {
      setDetail(await getBytebaseRequestDetail(row.request_id));
    } catch (e) {
      message.error(errorText(e, "申请详情加载失败"));
    } finally {
      setDetailLoading(false);
    }
  };
  const cancelRequest = (row: BytebaseRequest) => {
    let code = "", reason = "";
    const beforeRelease = row.status === "AWAITING_ADMIN_CONFIRMATION";
    Modal.confirm({
      title: beforeRelease ? "撤销待确认申请" : "停止 Bytebase 发布",
      icon: <StopOutlined />,
      width: 620,
      content: <Space direction="vertical" style={{ width: "100%" }}>
        <Alert type="warning" showIcon
          message={beforeRelease ? "撤销后不能再确认发布" : "停止为尽力而为，不是数据库回滚"}
          description={beforeRelease ? "Bytebase Draft Issue 会被取消，SQL 不会执行。" : "运行中的数据库语句可能无法中断，已经执行的 SQL 不会撤销；后台会继续对账最终状态。"}
        />
        <Input.TextArea rows={2} placeholder="取消原因（可选）" onChange={(e) => { reason = e.target.value; }} />
        <Input.Password placeholder="Google Authenticator 验证码" onChange={(e) => { code = e.target.value; }} />
      </Space>,
      okText: beforeRelease ? "确认撤销" : "确认停止发布",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await cancelBytebaseRequest(row.request_id, code, reason);
          message.success(result.bestEffort ? "已提交停止请求，正在确认最终状态" : "申请已撤销");
          setDetail(undefined);
          await load();
        } catch (e) {
          message.error(errorText(e, "取消失败"));
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
                    width: 230,
                    render: (_, r) => <Space size={4}>
                      <Button size="small" icon={<EyeOutlined />} loading={detailLoading} onClick={() => void openDetail(r)}>详情</Button>
                      {canRollout && r.plan_name && (
                        <Button
                          danger
                          size="small"
                          disabled={r.status !== "AWAITING_ADMIN_CONFIRMATION"}
                          onClick={() => rollout(r)}
                        >
                          确认发布
                        </Button>
                      )}
                      {canRollout && ["AWAITING_ADMIN_CONFIRMATION", "RELEASE_CONFIRMED", "ROLLOUT_RUNNING", "UNKNOWN"].includes(r.status) && (
                        <Button danger size="small" icon={<StopOutlined />} onClick={() => cancelRequest(r)}>
                          {r.status === "AWAITING_ADMIN_CONFIRMATION" ? "撤销" : "停止"}
                        </Button>
                      )}
                    </Space>,
                  },
                ]}
              />
            ),
          },
        ]}
      />
      <Modal open={Boolean(detail)} title="Bytebase 申请详情" width={900} footer={null} onCancel={() => setDetail(undefined)}>
        {detail && <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Descriptions bordered size="small" column={2} items={[
            { key: "title", label: "标题", children: detail.request.title },
            { key: "actor", label: "提交人", children: detail.request.actor_username },
            { key: "environment", label: "环境", children: detail.request.environment_id },
            { key: "status", label: "状态", children: <Tag>{detail.request.status}</Tag> },
            { key: "project", label: "项目", children: detail.request.project_name, span: 2 },
            { key: "database", label: "数据库", children: detail.request.database_name, span: 2 },
            { key: "issue", label: "Issue", children: detail.request.issue_name || "-", span: 2 },
            { key: "plan", label: "Plan", children: detail.request.plan_name || "-", span: 2 },
          ]} />
          <Divider plain>SQL（从 Bytebase Sheet 实时读取）</Divider>
          {detail.statementIntegrity === "CHANGED" && <Alert type="error" showIcon message="SQL 内容与申请提交时的哈希不一致，禁止据此确认发布" />}
          <Tag color={detail.statementIntegrity === "VERIFIED" ? "success" : detail.statementIntegrity === "CHANGED" ? "error" : "default"}>
            {detail.statementIntegrity === "VERIFIED" ? "内容校验通过" : detail.statementIntegrity === "CHANGED" ? "内容已变化" : "无法校验"}
          </Tag>
          <Input.TextArea value={detail.statement || "未找到 SQL Sheet"} readOnly autoSize={{ minRows: 8, maxRows: 20 }} style={{ fontFamily: "monospace" }} />
          <Divider plain>部署诊断</Divider>
          {detail.deploymentDiagnostics?.length ? detail.deploymentDiagnostics.map((run) => <Alert
            key={run.name}
            type="error"
            showIcon
            message={`${run.status} · ${run.name.split("/").slice(-3).join("/")}`}
            description={<Space direction="vertical" size={6} style={{ width: "100%" }}>
              {run.errors.map((error, index) => <Typography.Text key={`${run.name}-error-${index}`} code copyable>{error}</Typography.Text>)}
              {run.timeline.map((entry, index) => <Space key={`${run.name}-log-${index}`} wrap>
                <Tag color={entry.status === "ERROR" ? "error" : "default"}>{entry.type}</Tag>
                {entry.action && <Tag>{entry.action}</Tag>}
                {entry.error && <Typography.Text type="danger">{entry.error}</Typography.Text>}
              </Space>)}
            </Space>}
          />) : <Typography.Text type="secondary">未发现失败或取消的 Bytebase TaskRun</Typography.Text>}
          <Divider plain>流转记录</Divider>
          {detail.events.length ? detail.events.map((event, index) => <Typography.Paragraph key={`${event.created_at}-${index}`} style={{ marginBottom: 4 }}>
            <Typography.Text type="secondary">{new Date(event.created_at).toLocaleString()} </Typography.Text>
            <Tag>{event.event_type}</Tag>{event.summary}
          </Typography.Paragraph>) : <Typography.Text type="secondary">暂无流转记录</Typography.Text>}
        </Space>}
      </Modal>
    </Space>
  );
};
export default BytebaseCenterPage;
