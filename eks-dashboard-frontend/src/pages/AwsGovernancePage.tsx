import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Descriptions, Input, message, Modal, Select, Space, Tabs, Tag, Typography } from "antd";
import { CloudSyncOutlined, SafetyCertificateOutlined, SearchOutlined } from "@ant-design/icons";
import { AuthContext } from "../contexts/AuthContextValue";
import { DetailDrawer, MetricGrid, OpsTable, PageHeader } from "../components/ops";
import {
  diagnoseAwsGovernanceAccount,
  approveAwsRemediation,
  createAwsRemediation,
  executeAwsRemediation,
  exportAwsFindings,
  getAwsGovernanceOverview,
  getAwsInventoryRun,
  listAwsGovernanceResources,
  listAwsFindings,
  listAwsInventoryRuns,
  listAwsRemediations,
  listAwsResourceChanges,
  startAwsInventoryRun,
  previewAwsRemediation,
  rollbackAwsRemediation,
  transitionAwsFinding,
  type AwsFinding,
  type AwsGovernanceOverview,
  type AwsGovernanceResource,
  type AwsInventoryRun,
  type AwsRemediationTask,
  type AwsRemediationPreview,
  type AwsResourceChange,
} from "../services/api";
import { formatDateTime } from "../utils/time";

const terminalRunStatuses = new Set(["SUCCEEDED", "PARTIAL", "FAILED"]);
const runColor: Record<string, string> = {
  PENDING: "default",
  RUNNING: "processing",
  SUCCEEDED: "success",
  PARTIAL: "warning",
  FAILED: "error",
};

const requestErrorMessage = (reason: unknown, fallback: string) => {
  if (!reason || typeof reason !== "object") return fallback;
  const candidate = reason as { message?: unknown; response?: { data?: { message?: unknown } } };
  const apiMessage = candidate.response?.data?.message;
  if (typeof apiMessage === "string" && apiMessage) return apiMessage;
  return typeof candidate.message === "string" && candidate.message ? candidate.message : fallback;
};

const AwsGovernancePage: React.FC = () => {
  const { permissions } = useContext(AuthContext);
  const [overview, setOverview] = useState<AwsGovernanceOverview | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("resources");
  const [resources, setResources] = useState<AwsGovernanceResource[]>([]);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [runs, setRuns] = useState<AwsInventoryRun[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [changes, setChanges] = useState<AwsResourceChange[]>([]);
  const [changeTotal, setChangeTotal] = useState(0);
  const [findings, setFindings] = useState<AwsFinding[]>([]);
  const [findingTotal, setFindingTotal] = useState(0);
  const [findingStatus, setFindingStatus] = useState<string>();
  const [findingSeverity, setFindingSeverity] = useState<string>();
  const [findingAction, setFindingAction] = useState<{ finding: AwsFinding; action: "acknowledge" | "accept-risk" | "resolve" | "reopen" | "false-positive" } | null>(null);
  const [findingNote, setFindingNote] = useState("");
  const [exemptUntil, setExemptUntil] = useState("");
  const [findingSaving, setFindingSaving] = useState(false);
  const [remediations, setRemediations] = useState<AwsRemediationTask[]>([]);
  const [remediationFinding, setRemediationFinding] = useState<AwsFinding | null>(null);
  const [remediationForm, setRemediationForm] = useState({ environment: "", owner: "", reason: "", rollbackPlan: "移除本次新增标签，恢复执行前标签值", maintenanceStart: "", maintenanceEnd: "" });
  const [remediationPreview, setRemediationPreview] = useState<AwsRemediationPreview | null>(null);
  const [remediationSaving, setRemediationSaving] = useState(false);
  const [locatingRemediationResourceId, setLocatingRemediationResourceId] = useState<string | null>(null);
  const [taskAction, setTaskAction] = useState<{ task: AwsRemediationTask; action: "approve" | "execute" | "rollback" } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [resourceType, setResourceType] = useState<string>();
  const [region, setRegion] = useState<string>();
  const [selected, setSelected] = useState<AwsGovernanceResource | AwsInventoryRun | AwsResourceChange | AwsFinding | AwsRemediationTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const selectedAccount = overview?.accounts.find((account) => account.id === accountId) || null;
  const canSync = permissions.includes("aws-governance:inventory:run");
  const canDiagnose = permissions.includes("aws-governance:config:manage");
  const canManageFinding = permissions.includes("aws-governance:finding:manage");
  const canRequestRemediation = permissions.includes("aws-governance:remediation:request");
  const canApproveRemediation = permissions.includes("aws-governance:remediation:approve");
  const canExecuteRemediation = permissions.includes("aws-governance:remediation:execute");
  const canRollbackRemediation = permissions.includes("aws-governance:remediation:rollback");

  const loadOverview = useCallback(async () => {
    const data = await getAwsGovernanceOverview();
    setOverview(data);
    setAccountId((current) => current && data.accounts.some((account) => account.id === current) ? current : data.accounts[0]?.id || null);
    return data;
  }, []);

  const loadTab = useCallback(async () => {
    if (!accountId) return;
    if (activeTab === "resources") {
      const data = await listAwsGovernanceResources({ accountId, resourceType, region, keyword, page: 1, pageSize: 100 });
      setResources(data.items); setResourceTotal(data.total);
    } else if (activeTab === "runs") {
      const data = await listAwsInventoryRuns(accountId, 1, 100);
      setRuns(data.items); setRunTotal(data.total);
    } else if (activeTab === "changes") {
      const data = await listAwsResourceChanges({ accountId, page: 1, pageSize: 100 });
      setChanges(data.items); setChangeTotal(data.total);
    } else if (activeTab === "findings") {
      const data = await listAwsFindings({ accountId, status: findingStatus, severity: findingSeverity, keyword, page: 1, pageSize: 100 });
      setFindings(data.items); setFindingTotal(data.total);
    } else {
      setRemediations(await listAwsRemediations(accountId));
    }
  }, [accountId, activeTab, findingSeverity, findingStatus, keyword, region, resourceType]);

  useEffect(() => {
    setLoading(true); setError(null);
    void loadOverview().catch((reason: unknown) => setError(requestErrorMessage(reason, "加载 AWS 云资源治理失败"))).finally(() => setLoading(false));
  }, [loadOverview]);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true); setError(null);
    void loadTab().catch((reason: unknown) => setError(requestErrorMessage(reason, "加载列表失败"))).finally(() => setLoading(false));
  }, [accountId, loadTab]);

  useEffect(() => () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); }, []);

  const refreshAll = async () => {
    await Promise.all([loadOverview(), loadTab()]);
  };

  const pollRun = async (runId: number) => {
    const run = await getAwsInventoryRun(runId);
    if (terminalRunStatuses.has(run.status)) {
      setSyncing(false);
      await refreshAll();
      message.open({ type: run.status === "SUCCEEDED" ? "success" : run.status === "PARTIAL" ? "warning" : "error", content: run.status === "SUCCEEDED" ? "AWS Inventory 同步完成" : run.status === "PARTIAL" ? "同步部分完成，请查看任务错误" : "AWS Inventory 同步失败" });
      return;
    }
    pollTimer.current = window.setTimeout(() => void pollRun(runId).catch(() => setSyncing(false)), 1500);
  };

  const startSync = async () => {
    if (!accountId) return;
    setSyncing(true);
    try {
      const run = await startAwsInventoryRun(accountId);
      message.info(run.joined ? "已有同步任务运行，已继续追踪" : "已启动 AWS Inventory 同步");
      await pollRun(run.runId);
    } catch (reason: unknown) {
      setSyncing(false);
      message.error(requestErrorMessage(reason, "启动同步失败"));
    }
  };

  const diagnose = async () => {
    if (!accountId) return;
    setDiagnosing(true);
    try {
      const result = await diagnoseAwsGovernanceAccount(accountId);
      if (result.ok) message.success(`Audit Role 连接正常：${result.arn}`);
      else message.error(`${result.errorCode || "诊断失败"}：${result.errorMessage || "身份不匹配"}`);
    } finally { setDiagnosing(false); }
  };

  const typeOptions = useMemo(() => (overview?.byType || []).map((item) => ({ label: `${item.resourceType} (${item.count})`, value: item.resourceType })), [overview]);
  const regionOptions = useMemo(() => Array.from(new Set(["global", ...(selectedAccount?.defaultRegions || [])])).map((value) => ({ label: value, value })), [selectedAccount]);

  const openRemediationForResource = async (resource: AwsGovernanceResource) => {
    if (!accountId) return;
    setLocatingRemediationResourceId(resource.resourceId);
    try {
      const result = await listAwsFindings({ accountId, keyword: resource.resourceId, page: 1, pageSize: 100 });
      const finding = result.items.find((item) =>
        item.resourceId === resource.resourceId
        && item.resourceType === resource.resourceType
        && item.ruleKey === "required-tags-missing"
        && ["OPEN", "ACKNOWLEDGED", "REOPENED"].includes(item.status));
      if (!finding) {
        message.warning("该资源当前没有可执行的必要标签整改 Finding，请先同步 Inventory 并运行规则检测");
        return;
      }
      setRemediationFinding(finding);
      setRemediationPreview(null);
    } catch (reason: unknown) {
      message.error(requestErrorMessage(reason, "查询可整改 Finding 失败"));
    } finally {
      setLocatingRemediationResourceId(null);
    }
  };

  const resourceColumns = [
    { title: "资源", key: "resource", render: (_: unknown, row: AwsGovernanceResource) => <Space direction="vertical" size={0}><Typography.Text strong>{row.displayName || row.resourceId}</Typography.Text><Typography.Text type="secondary" copyable>{row.resourceId}</Typography.Text></Space> },
    { title: "类型", dataIndex: "resourceType", key: "resourceType", render: (value: string) => <Tag>{value}</Tag> },
    { title: "区域", dataIndex: "region", key: "region" },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string | null) => value ? <Tag color="blue">{value}</Tag> : "-" },
    { title: "最后发现", dataIndex: "lastSeenAt", key: "lastSeenAt", render: (value: string | null) => value ? formatDateTime(value) : "-" },
    { title: "操作", key: "action", render: (_: unknown, row: AwsGovernanceResource) => <Space wrap><Button type="link" onClick={() => setSelected(row)}>详情</Button>{canRequestRemediation && ["ec2:instance", "ec2:volume", "ec2:security-group"].includes(row.resourceType) && <Button type="link" loading={locatingRemediationResourceId === row.resourceId} onClick={() => void openRemediationForResource(row)}>创建整改任务</Button>}</Space> },
  ];
  const runColumns = [
    { title: "任务", dataIndex: "id", key: "id", render: (value: number) => `#${value}` },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <Tag color={runColor[value]}>{value}</Tag> },
    { title: "模式", dataIndex: "mode", key: "mode" },
    { title: "资源", dataIndex: "resourceCount", key: "resourceCount" },
    { title: "变更", dataIndex: "changeCount", key: "changeCount" },
    { title: "错误", dataIndex: "errorCount", key: "errorCount", render: (value: number) => <Tag color={value ? "error" : "success"}>{value}</Tag> },
    { title: "开始时间", dataIndex: "startedAt", key: "startedAt", render: (value: string | null) => value ? formatDateTime(value) : "-" },
    { title: "操作", key: "action", render: (_: unknown, row: AwsInventoryRun) => <Button type="link" onClick={() => setSelected(row)}>详情</Button> },
  ];
  const changeColumns = [
    { title: "变更", dataIndex: "changeType", key: "changeType", render: (value: string) => <Tag color={value === "CREATED" ? "success" : value === "DELETED" ? "error" : "processing"}>{value}</Tag> },
    { title: "资源类型", dataIndex: "resourceType", key: "resourceType" },
    { title: "资源 ID", dataIndex: "resourceId", key: "resourceId", ellipsis: true },
    { title: "区域", dataIndex: "region", key: "region" },
    { title: "发现时间", dataIndex: "detectedAt", key: "detectedAt", render: (value: string | null) => value ? formatDateTime(value) : "-" },
    { title: "操作", key: "action", render: (_: unknown, row: AwsResourceChange) => <Button type="link" onClick={() => setSelected(row)}>详情</Button> },
  ];
  const severityColor: Record<string, string> = { CRITICAL: "magenta", HIGH: "red", MEDIUM: "orange", LOW: "blue" };
  const findingColumns = [
    { title: "严重度", dataIndex: "severity", key: "severity", render: (value: string) => <Tag color={severityColor[value]}>{value}</Tag> },
    { title: "风险", key: "finding", render: (_: unknown, row: AwsFinding) => <Space direction="vertical" size={0}><Typography.Text strong>{row.title}</Typography.Text><Typography.Text type="secondary">{row.summary}</Typography.Text></Space> },
    { title: "资源", key: "resource", render: (_: unknown, row: AwsFinding) => <Space direction="vertical" size={0}><Typography.Text>{row.resourceType}</Typography.Text><Typography.Text type="secondary" copyable>{row.resourceId}</Typography.Text></Space> },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <Tag>{value}</Tag> },
    { title: "最后命中", dataIndex: "lastSeenAt", key: "lastSeenAt", render: (value: string | null) => value ? formatDateTime(value) : "-" },
    { title: "操作", key: "action", render: (_: unknown, row: AwsFinding) => <Space wrap><Button type="link" onClick={() => setSelected(row)}>详情</Button>{canRequestRemediation && row.ruleKey === "required-tags-missing" && ["ec2:instance", "ec2:volume", "ec2:security-group"].includes(row.resourceType) && ["OPEN", "ACKNOWLEDGED", "REOPENED"].includes(row.status) && <Button type="link" onClick={() => { setRemediationFinding(row); setRemediationPreview(null); }}>创建整改任务</Button>}{canManageFinding && ["OPEN", "REOPENED"].includes(row.status) && <Button type="link" onClick={() => setFindingAction({ finding: row, action: "acknowledge" })}>确认</Button>}{canManageFinding && ["OPEN", "ACKNOWLEDGED", "REOPENED"].includes(row.status) && <Button type="link" onClick={() => setFindingAction({ finding: row, action: "accept-risk" })}>接受风险</Button>}{canManageFinding && ["OPEN", "ACKNOWLEDGED", "REOPENED"].includes(row.status) && <Button type="link" onClick={() => setFindingAction({ finding: row, action: "false-positive" })}>误报</Button>}{canManageFinding && ["OPEN", "ACKNOWLEDGED", "REMEDIATING", "REOPENED"].includes(row.status) && <Button type="link" onClick={() => setFindingAction({ finding: row, action: "resolve" })}>解决</Button>}{canManageFinding && ["RESOLVED", "ACCEPTED_RISK", "FALSE_POSITIVE"].includes(row.status) && <Button type="link" onClick={() => setFindingAction({ finding: row, action: "reopen" })}>重开</Button>}</Space> },
  ];

  const remediationColumns = [
    { title: "任务", key: "task", render: (_: unknown, row: AwsRemediationTask) => <Space direction="vertical" size={0}><Typography.Text strong>#{row.id} · {row.resourceId}</Typography.Text><Typography.Text type="secondary">{row.resourceType} / {row.region}</Typography.Text></Space> },
    { title: "目标标签", dataIndex: "desiredTags", key: "desiredTags", render: (value: Record<string, string>) => <Space wrap>{Object.entries(value).map(([key, item]) => <Tag key={key}>{key}={item}</Tag>)}</Space> },
    { title: "维护窗口", key: "window", render: (_: unknown, row: AwsRemediationTask) => <>{formatDateTime(row.maintenanceStart)}<br />至 {formatDateTime(row.maintenanceEnd)}</> },
    { title: "状态", dataIndex: "status", key: "status", render: (value: string) => <Tag color={value === "SUCCEEDED" ? "success" : value === "FAILED" ? "error" : value === "APPROVED" ? "processing" : "default"}>{value}</Tag> },
    { title: "操作", key: "action", render: (_: unknown, row: AwsRemediationTask) => <Space wrap><Button type="link" onClick={() => setSelected(row)}>详情</Button>{canApproveRemediation && row.status === "PENDING_APPROVAL" && <Button type="link" onClick={() => setTaskAction({ task: row, action: "approve" })}>审批</Button>}{canExecuteRemediation && row.status === "APPROVED" && <Button type="link" onClick={() => setTaskAction({ task: row, action: "execute" })}>执行</Button>}{canRollbackRemediation && row.status === "SUCCEEDED" && <Button danger type="link" onClick={() => setTaskAction({ task: row, action: "rollback" })}>回滚</Button>}</Space> },
  ];

  const remediationInput = () => ({
    desiredTags: Object.fromEntries(Object.entries({ environment: remediationForm.environment, owner: remediationForm.owner }).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
    reason: remediationForm.reason,
    rollbackPlan: remediationForm.rollbackPlan,
    maintenanceStart: new Date(remediationForm.maintenanceStart).toISOString(),
    maintenanceEnd: new Date(remediationForm.maintenanceEnd).toISOString(),
    clientRequestId: crypto.randomUUID(),
  });

  const previewRemediation = async () => {
    if (!accountId || !remediationFinding) return;
    setRemediationSaving(true);
    try { setRemediationPreview(await previewAwsRemediation(remediationFinding.id, accountId, remediationInput())); }
    catch (reason: unknown) { message.error(requestErrorMessage(reason, "整改预览失败")); }
    finally { setRemediationSaving(false); }
  };

  const submitRemediation = async () => {
    if (!accountId || !remediationFinding || !remediationPreview) return;
    setRemediationSaving(true);
    try {
      await createAwsRemediation(remediationFinding.id, accountId, remediationInput());
      message.success("整改任务已提交，等待另一名管理员审批");
      setRemediationFinding(null); setRemediationPreview(null); setActiveTab("remediations");
      await loadTab();
    } catch (reason: unknown) { message.error(requestErrorMessage(reason, "提交整改任务失败")); }
    finally { setRemediationSaving(false); }
  };

  const submitTaskAction = async () => {
    if (!accountId || !taskAction || !/^\d{6}$/.test(mfaCode)) return;
    setRemediationSaving(true);
    try {
      if (taskAction.action === "approve") await approveAwsRemediation(taskAction.task.id, accountId, mfaCode);
      else if (taskAction.action === "execute") await executeAwsRemediation(taskAction.task.id, accountId, mfaCode);
      else await rollbackAwsRemediation(taskAction.task.id, accountId, mfaCode);
      message.success(taskAction.action === "approve" ? "整改任务已审批" : taskAction.action === "execute" ? "整改已执行，正在重新盘点" : "整改已回滚，正在重新盘点");
      setTaskAction(null); setMfaCode(""); await refreshAll();
    } catch (reason: unknown) { message.error(requestErrorMessage(reason, "操作失败")); }
    finally { setRemediationSaving(false); }
  };

  const submitFindingAction = async () => {
    if (!accountId || !findingAction || !findingNote.trim()) return;
    if (findingAction.action === "accept-risk" && !exemptUntil) return;
    setFindingSaving(true);
    try {
      await transitionAwsFinding(findingAction.finding.id, accountId, findingAction.action, {
        note: findingNote.trim(),
        exemptUntil: exemptUntil ? new Date(exemptUntil).toISOString() : undefined,
        clientRequestId: crypto.randomUUID(),
      });
      message.success("风险状态已更新");
      setFindingAction(null); setFindingNote(""); setExemptUntil("");
      await refreshAll();
    } catch (reason: unknown) { message.error(requestErrorMessage(reason, "风险状态更新失败")); }
    finally { setFindingSaving(false); }
  };

  const downloadFindings = async () => {
    if (!accountId) return;
    const blob = await exportAwsFindings({ accountId, status: findingStatus, severity: findingSeverity, keyword });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `aws-findings-${selectedAccount?.environmentId || "export"}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  };

  return <Space direction="vertical" size={20} style={{ width: "100%" }}>
    <PageHeader
      title="AWS 云资源治理"
      description="使用独立 Platform Audit Role 同步只读资源快照；第一版仅接入 hashex。"
      environmentName={selectedAccount?.environmentId || "未接入"}
      scope={selectedAccount ? <Tag color="geekblue">AWS {selectedAccount.accountId}</Tag> : undefined}
      actions={<Space>
        {canDiagnose && <Button icon={<SafetyCertificateOutlined />} loading={diagnosing} disabled={!accountId} onClick={() => void diagnose()}>身份诊断</Button>}
        {canSync && <Button type="primary" icon={<CloudSyncOutlined />} loading={syncing} disabled={!accountId} onClick={() => void startSync()}>同步 Inventory</Button>}
      </Space>}
    />
    {error && <Alert type="error" showIcon message="加载失败" description={error} />}
    {!loading && overview && !overview.accounts.length && <Alert type="warning" showIcon message="未授权 AWS 云账号" description="当前角色尚未绑定任何 AWS 云账号范围。" />}
    <MetricGrid loading={loading} items={[
      { key: "resources", label: "当前资源", value: overview?.metrics.resources || 0 },
      { key: "changes", label: "24 小时变更", value: overview?.metrics.changes24h || 0 },
      { key: "failed", label: "24 小时异常任务", value: overview?.metrics.failedRuns24h || 0, valueStyle: overview?.metrics.failedRuns24h ? { color: "#cf1322" } : undefined },
      { key: "findings", label: "开放风险", value: overview?.findings?.open || 0, valueStyle: overview?.findings?.open ? { color: "#cf1322" } : undefined },
      { key: "last", label: "最近成功同步", value: overview?.metrics.lastSuccessfulAt ? formatDateTime(overview.metrics.lastSuccessfulAt) : "尚未同步" },
    ]} />
    <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
      { key: "resources", label: `资源目录 (${resourceTotal})` },
      { key: "runs", label: `同步任务 (${runTotal})` },
      { key: "changes", label: `变更记录 (${changeTotal})` },
      { key: "findings", label: `风险发现 (${findingTotal})` },
      { key: "remediations", label: `整改任务 (${remediations.length})` },
    ]} />
    {activeTab === "resources" && <>
      <Space wrap>
        <Input value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} onPressEnter={() => setKeyword(keywordDraft.trim())} placeholder="搜索资源名称、ID 或 ARN" style={{ width: 300 }} allowClear />
        <Select value={resourceType} onChange={setResourceType} options={typeOptions} placeholder="资源类型" allowClear showSearch style={{ width: 240 }} />
        <Select value={region} onChange={setRegion} options={regionOptions} placeholder="区域" allowClear showSearch style={{ width: 160 }} />
        <Button icon={<SearchOutlined />} onClick={() => setKeyword(keywordDraft.trim())}>查询</Button>
        <Button onClick={() => void downloadFindings()}>导出 CSV</Button>
      </Space>
      <OpsTable rowKey="id" loading={loading} dataSource={resources} columns={resourceColumns} pagination={false} emptyDescription="尚无资源快照，请执行同步" />
    </>}
    {activeTab === "runs" && <OpsTable rowKey="id" loading={loading} dataSource={runs} columns={runColumns} pagination={false} emptyDescription="尚无同步任务" />}
    {activeTab === "changes" && <OpsTable rowKey="id" loading={loading} dataSource={changes} columns={changeColumns} pagination={false} emptyDescription="尚无资源变更" />}
    {activeTab === "findings" && <>
      <Space wrap>
        <Input value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} onPressEnter={() => setKeyword(keywordDraft.trim())} placeholder="搜索风险标题或资源 ID" style={{ width: 300 }} allowClear />
        <Select value={findingSeverity} onChange={setFindingSeverity} options={["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((value) => ({ label: value, value }))} placeholder="严重度" allowClear style={{ width: 150 }} />
        <Select value={findingStatus} onChange={setFindingStatus} options={["OPEN", "ACKNOWLEDGED", "ACCEPTED_RISK", "RESOLVED", "REOPENED", "FALSE_POSITIVE"].map((value) => ({ label: value, value }))} placeholder="处置状态" allowClear style={{ width: 180 }} />
        <Button icon={<SearchOutlined />} onClick={() => setKeyword(keywordDraft.trim())}>查询</Button>
      </Space>
      <OpsTable rowKey="id" loading={loading} dataSource={findings} columns={findingColumns} pagination={false} emptyDescription="当前没有风险发现" />
    </>}
    {activeTab === "remediations" && <OpsTable rowKey="id" loading={loading} dataSource={remediations} columns={remediationColumns} pagination={false} emptyDescription="尚无受控整改任务" />}
    <DetailDrawer open={Boolean(selected)} onClose={() => setSelected(null)} title="AWS 资源治理详情">
      {selected && <Descriptions bordered column={1} size="small">
        {Object.entries(selected).map(([key, value]) => <Descriptions.Item key={key} label={key}>
          {typeof value === "object" && value !== null ? <Typography.Paragraph copyable style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}><code>{JSON.stringify(value, null, 2)}</code></Typography.Paragraph> : String(value ?? "-")}
        </Descriptions.Item>)}
      </Descriptions>}
    </DetailDrawer>
    <Modal open={Boolean(findingAction)} title={findingAction ? `风险处置：${findingAction.finding.title}` : "风险处置"} okText="确认" cancelText="取消" confirmLoading={findingSaving} okButtonProps={{ disabled: !findingNote.trim() || (findingAction?.action === "accept-risk" && !exemptUntil) }} onOk={() => void submitFindingAction()} onCancel={() => { setFindingAction(null); setFindingNote(""); setExemptUntil(""); }}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Input.TextArea rows={4} value={findingNote} onChange={(event) => setFindingNote(event.target.value)} placeholder="请输入处置原因或证据" />
        {findingAction?.action === "accept-risk" && <Input type="datetime-local" value={exemptUntil} onChange={(event) => setExemptUntil(event.target.value)} />}
      </Space>
    </Modal>
    <Modal open={Boolean(remediationFinding)} width={760} title="创建受控标签整改任务" okText={remediationPreview ? "提交审批" : "生成预览"} cancelText="取消" confirmLoading={remediationSaving} okButtonProps={{ disabled: !remediationForm.reason.trim() || !remediationForm.rollbackPlan.trim() || !remediationForm.maintenanceStart || !remediationForm.maintenanceEnd || (!remediationForm.environment.trim() && !remediationForm.owner.trim()) }} onOk={() => void (remediationPreview ? submitRemediation() : previewRemediation())} onCancel={() => { setRemediationFinding(null); setRemediationPreview(null); }}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Alert type="warning" showIcon message="仅允许整改 environment / owner 标签" description="任务须由另一名管理员 MFA 审批，并且只能在维护窗口内通过 AWS DryRun 后执行。" />
        <Input value={remediationForm.environment} onChange={(event) => { setRemediationPreview(null); setRemediationForm((current) => ({ ...current, environment: event.target.value })); }} placeholder="environment（可留空）" />
        <Input value={remediationForm.owner} onChange={(event) => { setRemediationPreview(null); setRemediationForm((current) => ({ ...current, owner: event.target.value })); }} placeholder="owner（可留空）" />
        <Input.TextArea value={remediationForm.reason} onChange={(event) => { setRemediationPreview(null); setRemediationForm((current) => ({ ...current, reason: event.target.value })); }} placeholder="整改原因" />
        <Input.TextArea value={remediationForm.rollbackPlan} onChange={(event) => { setRemediationPreview(null); setRemediationForm((current) => ({ ...current, rollbackPlan: event.target.value })); }} placeholder="回滚方案" />
        <Space><Input type="datetime-local" value={remediationForm.maintenanceStart} onChange={(event) => { setRemediationPreview(null); setRemediationForm((current) => ({ ...current, maintenanceStart: event.target.value })); }} /><Typography.Text>至</Typography.Text><Input type="datetime-local" value={remediationForm.maintenanceEnd} onChange={(event) => { setRemediationPreview(null); setRemediationForm((current) => ({ ...current, maintenanceEnd: event.target.value })); }} /></Space>
        {remediationPreview && <Descriptions bordered column={1} size="small"><Descriptions.Item label="资源">{remediationPreview.resourceId}</Descriptions.Item><Descriptions.Item label="变更预览"><pre style={{ margin: 0 }}>{JSON.stringify(remediationPreview.changes, null, 2)}</pre></Descriptions.Item></Descriptions>}
      </Space>
    </Modal>
    <Modal open={Boolean(taskAction)} title={taskAction?.action === "approve" ? "审批整改任务" : taskAction?.action === "execute" ? "确认执行整改" : "确认回滚整改"} okText="确认" cancelText="取消" confirmLoading={remediationSaving} okButtonProps={{ disabled: !/^\d{6}$/.test(mfaCode), danger: taskAction?.action === "rollback" }} onOk={() => void submitTaskAction()} onCancel={() => { setTaskAction(null); setMfaCode(""); }}>
      <Space direction="vertical" style={{ width: "100%" }}><Alert type="warning" showIcon message={taskAction?.action === "execute" ? "执行前会先调用 AWS DryRun；成功后自动重新盘点。" : taskAction?.action === "rollback" ? "将恢复执行前标签，并自动重新盘点。" : "提交人与审批人必须是不同管理员。"} /><Input.Password value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="请输入 6 位 MFA 验证码" /></Space>
    </Modal>
  </Space>;
};

export default AwsGovernancePage;
