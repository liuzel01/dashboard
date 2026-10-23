import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { EyeOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import { DetailDrawer, InlineHelpTooltip, OpsTable, PageHeader } from "../components/ops";
import { formatDateTime } from '../utils/time';
import { AuthContext } from "../contexts/AuthContextValue";
import { EnvironmentContext } from "../contexts/EnvironmentContextValue";
import { BytebaseRealtimeContext } from "../contexts/BytebaseRealtimeContextValue";
import {
  cancelBytebaseRequest,
  confirmBytebaseRelease,
  createBytebaseChange,
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
  const [project, setProject] = useState<string>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [databasesError, setDatabasesError] = useState<string | null>(null);
  const [databasesReloadKey, setDatabasesReloadKey] = useState(0);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [detail, setDetail] = useState<BytebaseRequestDetail>();
  const [detailLoadingRequestId, setDetailLoadingRequestId] = useState<string>();
  const detailRequestSequence = useRef(0);
  const [form] = Form.useForm();
  const env = currentEnvironment?.id;
  const canSubmit = permissions.includes("bytebase:change:submit"),
    canRollout = permissions.includes("bytebase:rollout:execute");
  const loadCatalog = useCallback(async () => {
    if (!env) return;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const catalog = await getBytebaseCatalog(env);
      setProjects(catalog.projects);
    } catch (e) {
      const error = errorText(e, "Bytebase 目录加载失败");
      setCatalogError(error);
      message.error(error);
    } finally {
      setCatalogLoading(false);
    }
  }, [env, message]);
  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    setRequestsError(null);
    try {
      setRequests(await listBytebaseRequests());
    } catch (e) {
      const error = errorText(e, "Bytebase 申请记录加载失败");
      setRequestsError(error);
      message.error(error);
    } finally {
      setRequestsLoading(false);
    }
  }, [message]);
  useEffect(() => {
    setProject(undefined);
    setDatabases([]);
    setDatabasesError(null);
    setDetail(undefined);
    detailRequestSequence.current += 1;
    setDetailLoadingRequestId(undefined);
    void loadCatalog();
    void loadRequests();
  }, [env, loadCatalog, loadRequests]);
  useEffect(() => {
    if (!socket) return;
    const refresh = () => void loadRequests();
    socket.on("bytebase-request-updated", refresh);
    return () => {
      socket.off("bytebase-request-updated", refresh);
    };
  }, [socket, loadRequests]);
  useEffect(() => {
    if (!env || !project) {
      setDatabases([]);
      setDatabasesLoading(false);
      setDatabasesError(null);
      return;
    }
    let active = true;
    setDatabases([]);
    setDatabasesLoading(true);
    setDatabasesError(null);
    getBytebaseDatabases(env, project)
      .then((x) => {
        if (active) setDatabases(x.databases || []);
      })
      .catch((e) => {
        if (!active) return;
        const error = errorText(e, "数据库目录加载失败");
        setDatabasesError(error);
        message.error(error);
      })
      .finally(() => {
        if (active) setDatabasesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [env, project, databasesReloadKey, message]);
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
    setSubmitLoading(true);
    try {
      await createBytebaseChange({ ...values, environmentId: env, project });
      message.success(
        "已创建 Bytebase Draft Issue，并启动 Plan Check；等待管理员确认发布",
      );
      form.resetFields(["title", "description", "statement"]);
      await loadRequests();
    } catch (e) {
      message.error(errorText(e, "创建变更失败"));
    } finally {
      setSubmitLoading(false);
    }
  };
  const rollout = (row: BytebaseRequest) => {
    let code = "";
    Modal.confirm({
      title: "确认 Bytebase 发布",
      icon: <SafetyCertificateOutlined />,
      content: <Space direction="vertical" style={{ width: "100%" }}>
        <Alert type="warning" showIcon message="确认后将立即执行数据库变更" description="Dashboard 会发布 Bytebase Draft，并创建真实 TaskRun 执行当前可运行的部署阶段。" />
        <Input.Password
          placeholder="Google Authenticator 验证码"
          onChange={(e) => {
            code = e.target.value;
          }}
        />
      </Space>,
      okText: "确认发布",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!row.plan_name) throw new Error("申请缺少 Plan");
        try {
          const result = await confirmBytebaseRelease(row.environment_id, row.plan_name, code);
          message.success(result.executionPending ? "发布已确认，Bytebase 正在准备部署阶段，可稍后再次点击确认发布" : "Bytebase 发布已开始，正在追踪执行状态");
          await loadRequests();
        } catch (e) {
          message.error(errorText(e, "发布失败"));
          throw e;
        }
      },
    });
  };
  const openDetail = async (row: BytebaseRequest) => {
    const requestSequence = ++detailRequestSequence.current;
    setDetailLoadingRequestId(row.request_id);
    try {
      const nextDetail = await getBytebaseRequestDetail(row.request_id);
      if (requestSequence === detailRequestSequence.current) {
        setDetail(nextDetail);
      }
    } catch (e) {
      if (requestSequence === detailRequestSequence.current) {
        message.error(errorText(e, "申请详情加载失败"));
      }
    } finally {
      if (requestSequence === detailRequestSequence.current) {
        setDetailLoadingRequestId(undefined);
      }
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
          await loadRequests();
        } catch (e) {
          message.error(errorText(e, "取消失败"));
          throw e;
        }
      },
    });
  };
  if (!env) return <Alert type="warning" showIcon message="请先选择目标环境" />;
  const tablePagination = {
    defaultPageSize: 20,
    pageSizeOptions: ["20", "50", "100"],
    showSizeChanger: true,
    showTotal: (total: number) => `共 ${total} 条`,
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader
        title={
          <Space size={6} align="center">
            <span>数据库访问与变更中心</span>
            <InlineHelpTooltip
              ariaLabel="数据库访问与变更说明"
              content={`Dashboard 负责统一授权与审计；数据库变更由 Bytebase Issue / Plan / Rollout 执行。当前实时状态：${realtimeConnected ? "已连接" : "连接中或不可用"}。`}
            />
          </Space>
        }
        description="统一管理 Bytebase 数据库目录、变更申请、发布确认与执行审计。"
        environmentName={currentEnvironment?.name || currentEnvironment?.id}
      />
      {catalogError && (
        <Alert
          type="error"
          showIcon
          message="Bytebase 项目目录加载失败"
          description={catalogError}
          action={<Button onClick={() => void loadCatalog()}>重试</Button>}
        />
      )}
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
            loading={catalogLoading}
            onClick={() => void loadCatalog()}
          >
            刷新目录
          </Button>
        </Space>
      </Card>
      <Tabs
        items={[
          {
            key: "catalog",
            label: "数据库目录",
            children: (
              <OpsTable
                rowKey="name"
                loading={databasesLoading}
                dataSource={databases}
                error={databasesError}
                onRetry={() => setDatabasesReloadKey((value) => value + 1)}
                emptyDescription={project ? "当前项目暂无数据库" : "请先选择 Bytebase 项目"}
                pagination={tablePagination}
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
                  <Button type="primary" htmlType="submit" loading={submitLoading}>
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
              <OpsTable
                rowKey="request_id"
                loading={requestsLoading}
                dataSource={requests}
                error={requestsError}
                onRetry={() => void loadRequests()}
                emptyDescription="暂无 Bytebase 申请记录"
                pagination={tablePagination}
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
                      <Button size="small" icon={<EyeOutlined />} loading={detailLoadingRequestId === r.request_id} onClick={() => void openDetail(r)}>详情</Button>
                      {canRollout && r.plan_name && ["AWAITING_ADMIN_CONFIRMATION", "RELEASE_CONFIRMED", "ROLLOUT_READY"].includes(r.status) && (
                        <Button
                          danger
                          size="small"
                          onClick={() => rollout(r)}
                        >
                          确认发布
                        </Button>
                      )}
                      {canRollout && ["AWAITING_ADMIN_CONFIRMATION", "RELEASE_CONFIRMED", "ROLLOUT_READY", "ROLLOUT_RUNNING", "UNKNOWN"].includes(r.status) && (
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
      <DetailDrawer open={Boolean(detail)} title="Bytebase 申请详情" width={900} onClose={() => setDetail(undefined)}>
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
            <Typography.Text type="secondary">{formatDateTime(event.created_at)} </Typography.Text>
            <Tag>{event.event_type}</Tag>{event.summary}
          </Typography.Paragraph>) : <Typography.Text type="secondary">暂无流转记录</Typography.Text>}
        </Space>}
      </DetailDrawer>
    </Space>
  );
};
export default BytebaseCenterPage;
