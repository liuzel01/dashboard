/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useContext, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { AuthContext } from "../contexts/AuthContextValue";
import {
  consumeJumpserverPortal,
  createJumpserverUserGrant,
  createJumpserverUserGrantFromTemplate,
  diagnoseJumpserver,
  getAccessUsers,
  getJumpserverCatalog,
  getJumpserverConfiguration,
  getJumpserverPermissionTemplate,
  getMyJumpserverStatus,
  prepareJumpserverPortal,
  syncJumpserverUser,
  unbindJumpserverUser,
  upsertJumpserverMapping,
  type JumpserverCatalogItem,
  type JumpserverPermissionTemplate,
} from "../services/api";
const { Title, Text } = Typography;
type UserCatalogData = {
  dashboardUsers: any[];
  jumpserverUsers: JumpserverCatalogItem[];
};
type TargetCatalogData = {
  assetItems: JumpserverCatalogItem[];
  nodeItems: JumpserverCatalogItem[];
};

export default function JumpserverAccessPage() {
  const { permissions } = useContext(AuthContext);
  const admin = permissions.includes("jumpserver:config:manage");
  const [statusLoading, setStatusLoading] = useState(false),
    [launchLoading, setLaunchLoading] = useState(false),
    [status, setStatus] = useState<any>(null),
    [diag, setDiag] = useState<any>(null),
    [cfg, setCfg] = useState<any>({
      mappings: [],
      userBindings: [],
    }),
    [users, setUsers] = useState<any[]>([]),
    [remoteUsers, setRemoteUsers] = useState<JumpserverCatalogItem[]>([]),
    [assets, setAssets] = useState<JumpserverCatalogItem[]>([]),
    [nodes, setNodes] = useState<JumpserverCatalogItem[]>([]),
    [permissionTemplates, setPermissionTemplates] = useState<
      JumpserverCatalogItem[]
    >([]),
    [templateModalOpen, setTemplateModalOpen] = useState(false),
    [templateUserId, setTemplateUserId] = useState<number>(),
    [templatePermissionId, setTemplatePermissionId] = useState<string>(),
    [templatePreview, setTemplatePreview] =
      useState<JumpserverPermissionTemplate>(),
    [templatePreviewLoading, setTemplatePreviewLoading] = useState(false),
    [templateSubmitting, setTemplateSubmitting] = useState(false),
    [templateSampleExpanded, setTemplateSampleExpanded] = useState(false),
    [configurationLoading, setConfigurationLoading] = useState(false),
    [diagnosticLoading, setDiagnosticLoading] = useState(false),
    [diagnosticOpen, setDiagnosticOpen] = useState(false),
    [mappingCatalogLoading, setMappingCatalogLoading] = useState(false),
    [customGrantCatalogLoading, setCustomGrantCatalogLoading] = useState(false),
    [templateCatalogLoading, setTemplateCatalogLoading] = useState(false);
  const configurationLoadedRef = useRef(false);
  const configurationDataRef = useRef<any>({ mappings: [], userBindings: [] });
  const configurationRequestRef = useRef<Promise<any> | null>(null);
  const userCatalogLoadedRef = useRef(false);
  const userCatalogRequestRef = useRef<Promise<UserCatalogData> | null>(null);
  const targetCatalogLoadedRef = useRef(false);
  const targetCatalogRequestRef = useRef<Promise<TargetCatalogData> | null>(
    null,
  );
  const permissionCatalogLoadedRef = useRef(false);
  const permissionCatalogRequestRef = useRef<Promise<void> | null>(null);
  const diagnosticRequestRef = useRef<Promise<void> | null>(null);
  const loadStatus = async () => {
    setStatusLoading(true);
    try {
      setStatus(await getMyJumpserverStatus());
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message);
    } finally {
      setStatusLoading(false);
    }
  };
  const loadConfiguration = async (force = false) => {
    if (!admin) return configurationDataRef.current;
    if (!force && configurationLoadedRef.current)
      return configurationDataRef.current;
    if (configurationRequestRef.current) return configurationRequestRef.current;
    const request = (async () => {
      setConfigurationLoading(true);
      try {
        const configuration = await getJumpserverConfiguration();
        configurationDataRef.current = configuration;
        setCfg(configuration);
        configurationLoadedRef.current = true;
        return configuration;
      } catch (e: any) {
        message.error(e?.response?.data?.message || e.message);
        throw e;
      } finally {
        setConfigurationLoading(false);
      }
    })();
    configurationRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (configurationRequestRef.current === request)
        configurationRequestRef.current = null;
    }
  };
  const loadUserCatalog = async (): Promise<UserCatalogData> => {
    if (userCatalogLoadedRef.current)
      return { dashboardUsers: users, jumpserverUsers: remoteUsers };
    if (userCatalogRequestRef.current) return userCatalogRequestRef.current;
    const request = Promise.all([
      getAccessUsers(),
      getJumpserverCatalog("users"),
    ]).then(([dashboardUsers, jumpserverUsers]) => {
      const normalizedUsers = dashboardUsers || [];
      setUsers(normalizedUsers);
      setRemoteUsers(jumpserverUsers.items);
      userCatalogLoadedRef.current = true;
      return {
        dashboardUsers: normalizedUsers,
        jumpserverUsers: jumpserverUsers.items,
      };
    });
    userCatalogRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (userCatalogRequestRef.current === request)
        userCatalogRequestRef.current = null;
    }
  };
  const loadTargetCatalog = async (): Promise<TargetCatalogData> => {
    if (targetCatalogLoadedRef.current)
      return { assetItems: assets, nodeItems: nodes };
    if (targetCatalogRequestRef.current) return targetCatalogRequestRef.current;
    const request = Promise.all([
      getJumpserverCatalog("assets"),
      getJumpserverCatalog("nodes"),
    ]).then(([assetCatalog, nodeCatalog]) => {
      setAssets(assetCatalog.items);
      setNodes(nodeCatalog.items);
      targetCatalogLoadedRef.current = true;
      return {
        assetItems: assetCatalog.items,
        nodeItems: nodeCatalog.items,
      };
    });
    targetCatalogRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (targetCatalogRequestRef.current === request)
        targetCatalogRequestRef.current = null;
    }
  };
  const loadPermissionCatalog = async () => {
    if (permissionCatalogLoadedRef.current) return;
    if (permissionCatalogRequestRef.current)
      return permissionCatalogRequestRef.current;
    const request = getJumpserverCatalog("permissions").then((catalog) => {
      setPermissionTemplates(catalog.items);
      permissionCatalogLoadedRef.current = true;
    });
    permissionCatalogRequestRef.current = request;
    try {
      await request;
    } finally {
      if (permissionCatalogRequestRef.current === request)
        permissionCatalogRequestRef.current = null;
    }
  };
  const loadDiagnostic = async () => {
    if (diagnosticRequestRef.current) return diagnosticRequestRef.current;
    const request = (async () => {
      setDiagnosticLoading(true);
      try {
        setDiag(await diagnoseJumpserver());
      } catch (e: any) {
        message.error(e?.response?.data?.message || e.message);
      } finally {
        setDiagnosticLoading(false);
      }
    })();
    diagnosticRequestRef.current = request;
    try {
      await request;
    } finally {
      if (diagnosticRequestRef.current === request)
        diagnosticRequestRef.current = null;
    }
  };
  const refreshAfterAdminChange = async () => {
    await Promise.allSettled([loadStatus(), loadConfiguration(true)]);
  };
  const refreshPage = async () => {
    await Promise.allSettled([
      loadStatus(),
      admin ? loadConfiguration(true) : undefined,
    ]);
  };
  useEffect(() => {
    void Promise.all([
      loadStatus(),
      admin ? loadConfiguration() : Promise.resolve(),
    ]).catch(() => undefined);
  }, []);
  const launch = async () => {
    try {
      setLaunchLoading(true);
      const p = await prepareJumpserverPortal();
      const r = await consumeJumpserverPortal(p.ticket);
      window.open(r.portalUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      message.error(e?.response?.data?.message || "无法进入 JumpServer");
    } finally {
      setLaunchLoading(false);
    }
  };
  const openMapping = async () => {
    setMappingCatalogLoading(true);
    let catalog: Awaited<ReturnType<typeof loadUserCatalog>>;
    try {
      catalog = await loadUserCatalog();
    } catch (e: any) {
      message.error(e?.response?.data?.message || "加载用户目录失败");
      return;
    } finally {
      setMappingCatalogLoading(false);
    }
    let dashboardUserId = 0,
      remoteUsername = "";
    Modal.confirm({
      title: "新增或更新身份映射",
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="运维系统用户"
            style={{ width: "100%" }}
            options={catalog.dashboardUsers.map((u) => ({
              value: u.id,
              label: `${u.display_name || u.username} (${u.username})`,
            }))}
            onChange={(v) => (dashboardUserId = v)}
          />
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="搜索并选择 JumpServer 用户"
            style={{ width: "100%" }}
            options={catalog.jumpserverUsers.map((u) => ({
              value: u.username || u.name,
              label: `${u.name}${u.username ? ` (${u.username})` : ""}`,
            }))}
            onChange={(v) => (remoteUsername = v)}
          />
        </Space>
      ),
      onOk: async () => {
        if (!dashboardUserId || !remoteUsername)
          throw new Error("请选择用户并填写 JumpServer username");
        await upsertJumpserverMapping({ dashboardUserId, remoteUsername });
        message.success("身份映射已保存");
        await refreshAfterAdminChange();
      },
    });
  };
  const openUserGrant = async () => {
    setCustomGrantCatalogLoading(true);
    let userCatalog: Awaited<ReturnType<typeof loadUserCatalog>>;
    let targetCatalog: Awaited<ReturnType<typeof loadTargetCatalog>>;
    let configuration: any;
    try {
      [userCatalog, targetCatalog, configuration] = await Promise.all([
        loadUserCatalog(),
        loadTargetCatalog(),
        loadConfiguration(),
      ]);
    } catch (e: any) {
      message.error(e?.response?.data?.message || "加载用户或资产目录失败");
      return;
    } finally {
      setCustomGrantCatalogLoading(false);
    }
    let dashboardUserId = 0,
      target = "";
    const mappedUserIds = new Set(
      configuration.mappings
        .filter((mapping: any) => mapping.status === "ACTIVE")
        .map((mapping: any) => Number(mapping.dashboard_user_id)),
    );
    Modal.confirm({
      width: 620,
      title: "新增用户资产授权",
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择已建立身份映射的运维系统用户"
            style={{ width: "100%" }}
            options={userCatalog.dashboardUsers
              .filter((user) => mappedUserIds.has(Number(user.id)))
              .map((user) => ({
                value: user.id,
                label: `${user.display_name || user.username} (${user.username})`,
              }))}
            onChange={(value) => (dashboardUserId = value)}
          />
          <Select
            showSearch
            placeholder="选择资产或节点"
            style={{ width: "100%" }}
            options={[
              ...targetCatalog.assetItems.map((x) => ({
                value: `ASSET|${x.id}|${x.name}${
                  x.nodesDisplay?.length
                    ? ` · ${x.nodesDisplay.join(", ")}`
                    : ""
                }`,
                label: `资产 · ${x.name}${
                  x.nodesDisplay?.length
                    ? ` · ${x.nodesDisplay.join(", ")}`
                    : ""
                }`,
              })),
              ...targetCatalog.nodeItems.map((x) => ({
                value: `NODE|${x.id}|${x.fullValue || x.name}`,
                label: `节点 · ${x.fullValue || x.name}`,
              })),
            ]}
            onChange={(v) => (target = v)}
          />
          <Alert
            type="warning"
            showIcon
            message="第一版默认允许所选范围内的 @ALL 账号与 ssh 协议；授权后请在 JumpServer 核对实际账号范围。"
          />
        </Space>
      ),
      onOk: async () => {
        if (!dashboardUserId || !target)
          throw new Error("请选择用户和资产范围");
        const [type, id, ...rest] = target.split("|");
        await createJumpserverUserGrant({
          dashboardUserId,
          targets: [
            { type: type as "ASSET" | "NODE", id, name: rest.join("|") },
          ],
          accounts: ["@ALL"],
          protocols: ["ssh"],
        });
        message.success("用户资产授权已创建并同步到 JumpServer");
        await refreshAfterAdminChange();
      },
    });
  };
  const mappedUserOptions = () => {
    const mappedUserIds = new Set(
      cfg.mappings
        .filter((mapping: any) => mapping.status === "ACTIVE")
        .map((mapping: any) => Number(mapping.dashboard_user_id)),
    );
    return users
      .filter((user) => mappedUserIds.has(Number(user.id)))
      .map((user) => ({
        value: Number(user.id),
        label: `${user.display_name || user.username} (${user.username})`,
      }));
  };
  const openTemplateGrant = async () => {
    setTemplateCatalogLoading(true);
    try {
      await Promise.all([
        loadUserCatalog(),
        loadPermissionCatalog(),
        loadConfiguration(),
      ]);
    } catch (e: any) {
      message.error(e?.response?.data?.message || "加载用户或授权模板失败");
      return;
    } finally {
      setTemplateCatalogLoading(false);
    }
    setTemplateUserId(undefined);
    setTemplatePermissionId(undefined);
    setTemplatePreview(undefined);
    setTemplateSampleExpanded(false);
    setTemplateModalOpen(true);
  };
  const selectPermissionTemplate = async (permissionId: string) => {
    setTemplatePermissionId(permissionId);
    setTemplatePreview(undefined);
    setTemplateSampleExpanded(false);
    setTemplatePreviewLoading(true);
    try {
      setTemplatePreview(await getJumpserverPermissionTemplate(permissionId));
    } catch (e: any) {
      message.error(e?.response?.data?.message || "读取授权模板失败");
    } finally {
      setTemplatePreviewLoading(false);
    }
  };
  const confirmTemplateGrant = async () => {
    if (!templateUserId || !templatePermissionId || !templatePreview) return;
    setTemplateSubmitting(true);
    try {
      await createJumpserverUserGrantFromTemplate({
        dashboardUserId: templateUserId,
        permissionId: templatePermissionId,
      });
      message.success("已复制授权范围并同步到 JumpServer");
      setTemplateModalOpen(false);
      await refreshAfterAdminChange();
    } catch (e: any) {
      message.error(e?.response?.data?.message || "复用授权模板失败");
    } finally {
      setTemplateSubmitting(false);
    }
  };
  const dashboardUserLabel = (record: any) =>
    record.dashboard_display_name || record.dashboard_username || "-";
  const dashboardUserCell = (record: any) => (
    <Space direction="vertical" size={0}>
      <Text>{dashboardUserLabel(record)}</Text>
      {record.dashboard_display_name &&
        record.dashboard_username &&
        record.dashboard_display_name !== record.dashboard_username && (
          <Text type="secondary">{record.dashboard_username}</Text>
        )}
    </Space>
  );
  const revokeBundle = (binding: any) =>
    Modal.confirm({
      title: "确认回收用户资产授权？",
      content: `将回收 ${dashboardUserLabel(binding)} 的“${binding.bundle_name}”授权。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        await unbindJumpserverUser(
          Number(binding.bundle_id),
          Number(binding.dashboard_user_id),
        );
        await syncJumpserverUser(Number(binding.dashboard_user_id));
        message.success("用户授权已回收并同步到 JumpServer");
        await refreshAfterAdminChange();
      },
    });
  const sync = (id: number) =>
    Modal.confirm({
      title: "确认同步远端授权？",
      content:
        "将根据管理员为该用户配置的资产范围，创建或回收 Dashboard 受管的 JumpServer Asset Permission。",
      onOk: async () => {
        const result = await syncJumpserverUser(id);
        const synced = result.results.filter(
          (item: { status: string }) => item.status === "SYNCED",
        ).length;
        const revoked = result.results.filter(
          (item: { status: string }) => item.status === "REVOKED",
        ).length;
        message.success(`同步完成：生效 ${synced}，回收 ${revoked}`);
        await refreshAfterAdminChange();
      },
    });
  const adminPanel = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card
        title="身份映射"
        extra={
          <Button
            loading={mappingCatalogLoading}
            onClick={() => void openMapping()}
          >
            新增映射
          </Button>
        }
      >
        <Table
          rowKey="id"
          pagination={false}
          dataSource={cfg.mappings}
          columns={[
            {
              title: "运维系统用户",
              render: (_, row: any) => dashboardUserCell(row),
            },
            { title: "JumpServer 用户", dataIndex: "remote_username" },
            {
              title: "状态",
              dataIndex: "status",
              render: (v) => (
                <Tag color={v === "ACTIVE" ? "green" : "default"}>{v}</Tag>
              ),
            },
            {
              title: "操作",
              render: (_, r: any) => (
                <Button
                  type="link"
                  onClick={() => sync(Number(r.dashboard_user_id))}
                >
                  同步授权
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="用户资产授权"
        extra={
          <Space>
            <Button
              loading={customGrantCatalogLoading}
              onClick={() => void openUserGrant()}
            >
              新增自定义授权
            </Button>
            <Button
              type="primary"
              loading={templateCatalogLoading}
              onClick={() => void openTemplateGrant()}
            >
              复用现有 Asset Permission
            </Button>
          </Space>
        }
      >
        <Table
          rowKey={(row: any) => `${row.dashboard_user_id}:${row.bundle_id}`}
          pagination={false}
          dataSource={cfg.userBindings.filter(
            (binding: any) => Number(binding.enabled) === 1,
          )}
          columns={[
            {
              title: "运维系统用户",
              render: (_, row: any) => dashboardUserCell(row),
            },
            {
              title: "资产范围",
              dataIndex: "targets",
              render: (
                targets: Array<{
                  type: "ASSET" | "NODE";
                  id: string;
                  name: string;
                }>,
              ) =>
                (targets || []).map((target) => (
                  <Tag key={`${target.type}:${target.id}`} title={target.id}>
                    {target.type === "NODE" ? "节点" : "资产"} · {target.name}
                  </Tag>
                )),
            },
            {
              title: "账号 / 协议",
              render: (_, row: any) =>
                `${(row.accounts || []).join(", ")} / ${(row.protocols || []).join(", ")}`,
            },
            {
              title: "来源",
              render: (_, row: any) =>
                row.source_permission_name ? (
                  <Tag color="blue">模板 · {row.source_permission_name}</Tag>
                ) : (
                  <Tag>自定义</Tag>
                ),
            },
            {
              title: "操作",
              render: (_, row: any) => (
                <Button danger type="link" onClick={() => revokeBundle(row)}>
                  回收授权
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
  return (
    <div>
      <Space
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            服务器访问（JumpServer）
          </Title>
          <Text type="secondary">
            Dashboard 功能权限与 JumpServer 用户资产授权分离管理
          </Text>
        </div>
        <Button loading={statusLoading} onClick={() => void refreshPage()}>
          刷新
        </Button>
      </Space>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={2}>
          <Descriptions.Item label="身份映射">
            {status?.mapped ? "已映射" : "未映射"}
          </Descriptions.Item>
          <Descriptions.Item label="访问状态">
            {status?.eligible ? (
              <Tag color="green">可进入</Tag>
            ) : (
              <Tag color="orange">尚不可进入</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="JumpServer 用户">
            {status?.remoteUsername || "-"}
          </Descriptions.Item>
          <Descriptions.Item label="受控授权">
            {status?.grants?.map((g: any) => (
              <Tag
                key={g.bundleId}
                color={
                  g.status === "SYNCED"
                    ? "green"
                    : g.status === "PARTIAL"
                      ? "orange"
                      : "red"
                }
              >
                {g.bundleName}:{" "}
                {g.status === "PARTIAL"
                  ? `部分生效 ${g.effectiveAssetCount}/${g.totalAssetCount}`
                  : g.status}
              </Tag>
            )) || "-"}
          </Descriptions.Item>
        </Descriptions>
        {status?.grants?.some((grant: any) => grant.status === "PARTIAL") && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="部分资产当前不可用"
            description="授权范围内存在没有有效账号或协议的资产；仍可进入 JumpServer 使用其余已生效资产，请在 JumpServer 中完善异常资产配置。"
          />
        )}
        <Button
          type="primary"
          disabled={!status?.eligible}
          loading={launchLoading}
          onClick={launch}
        >
          进入 JumpServer
        </Button>
      </Card>
      {admin && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Collapse
            activeKey={diagnosticOpen ? ["diagnostic"] : []}
            onChange={(keys) => {
              const nextOpen = (Array.isArray(keys) ? keys : [keys]).includes(
                "diagnostic",
              );
              setDiagnosticOpen(nextOpen);
              if (nextOpen && !diag && !diagnosticLoading)
                void loadDiagnostic();
            }}
            items={[
              {
                key: "diagnostic",
                label: "Provider 诊断",
                children: (
                  <Spin spinning={diagnosticLoading}>
                    <Descriptions column={2} size="small">
                      <Descriptions.Item label="Reader">
                        {diag?.reader?.ok ? (
                          <Tag color="green">正常 · {diag.reader.username}</Tag>
                        ) : diag ? (
                          <Tag color="red">异常</Tag>
                        ) : (
                          <Text type="secondary">尚未检查</Text>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="Grant Manager">
                        {diag?.grant?.ok ? (
                          <Tag color="green">正常 · {diag.grant.username}</Tag>
                        ) : diag ? (
                          <Tag color="red">异常</Tag>
                        ) : (
                          <Text type="secondary">尚未检查</Text>
                        )}
                      </Descriptions.Item>
                    </Descriptions>
                  </Spin>
                ),
              },
            ]}
          />
          <Spin spinning={configurationLoading}>{adminPanel}</Spin>
        </Space>
      )}
      <Modal
        width={720}
        title="复用现有 JumpServer Asset Permission"
        open={templateModalOpen}
        confirmLoading={templateSubmitting}
        okText="确认复制并授权"
        okButtonProps={{
          danger: Boolean(templatePreview?.risks.length),
          disabled:
            !templateUserId || !templatePermissionId || !templatePreview,
        }}
        onCancel={() => {
          setTemplateModalOpen(false);
          setTemplateSampleExpanded(false);
        }}
        onOk={() => void confirmTemplateGrant()}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="系统只复制所选 Asset Permission 的资产、节点、账号、协议和动作范围；不会复制源用户或用户组，也不会修改源 Permission。"
          />
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择已建立身份映射的运维系统用户"
            style={{ width: "100%" }}
            options={mappedUserOptions()}
            value={templateUserId}
            onChange={setTemplateUserId}
          />
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择现有 Asset Permission 作为授权模板"
            style={{ width: "100%" }}
            options={permissionTemplates.map((permission) => ({
              value: permission.id,
              label: permission.name,
            }))}
            value={templatePermissionId}
            loading={templatePreviewLoading}
            onChange={(value) => void selectPermissionTemplate(value)}
          />
          {templatePreview && (
            <>
              <Descriptions bordered size="small" column={3}>
                <Descriptions.Item label="模板名称" span={2}>
                  {templatePreview.name}
                </Descriptions.Item>
                <Descriptions.Item label="失效时间">
                  {templatePreview.dateExpired || "未返回"}
                </Descriptions.Item>
                <Descriptions.Item label="直接资产">
                  {
                    templatePreview.targets.filter((x) => x.type === "ASSET")
                      .length
                  }
                </Descriptions.Item>
                <Descriptions.Item label="授权节点">
                  {
                    templatePreview.targets.filter((x) => x.type === "NODE")
                      .length
                  }
                </Descriptions.Item>
                <Descriptions.Item label="当前有效资产">
                  {templatePreview.effectiveAssets.count}
                </Descriptions.Item>
                <Descriptions.Item label="账号" span={3}>
                  {templatePreview.accounts.join(", ")}
                </Descriptions.Item>
                <Descriptions.Item label="协议" span={3}>
                  {templatePreview.protocols.join(", ")}
                </Descriptions.Item>
                <Descriptions.Item label="动作" span={3}>
                  {templatePreview.actions.join(", ")}
                </Descriptions.Item>
                {templatePreview.effectiveAssets.sample.length > 0 && (
                  <Descriptions.Item label="有效资产样本" span={3}>
                    <Space
                      direction="vertical"
                      size={4}
                      style={{ width: "100%" }}
                    >
                      <div
                        style={{
                          maxHeight: templateSampleExpanded ? 160 : undefined,
                          overflowY: templateSampleExpanded
                            ? "auto"
                            : undefined,
                        }}
                      >
                        {templatePreview.effectiveAssets.sample
                          .slice(0, templateSampleExpanded ? 20 : 5)
                          .map((asset) => (
                            <Tag key={asset.id} style={{ marginBottom: 4 }}>
                              {asset.name}
                              {asset.address ? ` · ${asset.address}` : ""}
                            </Tag>
                          ))}
                      </div>
                      {templatePreview.effectiveAssets.sample.length > 5 && (
                        <Button
                          type="link"
                          size="small"
                          style={{ alignSelf: "flex-start", padding: 0 }}
                          onClick={() =>
                            setTemplateSampleExpanded((expanded) => !expanded)
                          }
                        >
                          {templateSampleExpanded
                            ? "收起"
                            : templatePreview.effectiveAssets.count >
                                templatePreview.effectiveAssets.sample.length
                              ? `展开更多样本（共 ${templatePreview.effectiveAssets.count} 个）`
                              : `展开更多（剩余 ${templatePreview.effectiveAssets.sample.length - 5} 个）`}
                        </Button>
                      )}
                      {templateSampleExpanded &&
                        templatePreview.effectiveAssets.count >
                          templatePreview.effectiveAssets.sample.length && (
                          <Text type="secondary">
                            当前仅展示前{" "}
                            {templatePreview.effectiveAssets.sample.length}{" "}
                            个，共 {templatePreview.effectiveAssets.count} 个
                          </Text>
                        )}
                    </Space>
                  </Descriptions.Item>
                )}
              </Descriptions>
              {templatePreview.targets.some((x) => x.type === "NODE") && (
                <Alert
                  type="info"
                  showIcon
                  message="当前有效资产数是按节点实时展开的预览；节点成员后续变化会影响实际授权范围。"
                />
              )}
              {templatePreview.risks.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="请确认以下授权风险"
                  description={templatePreview.risks.join("；")}
                />
              )}
            </>
          )}
        </Space>
      </Modal>
    </div>
  );
}
