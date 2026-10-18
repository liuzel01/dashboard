/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useContext, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { AuthContext } from "../contexts/AuthContextValue";
import {
  consumeJumpserverPortal,
  createJumpserverUserGrant,
  diagnoseJumpserver,
  getAccessUsers,
  getJumpserverCatalog,
  getJumpserverConfiguration,
  getMyJumpserverStatus,
  prepareJumpserverPortal,
  syncJumpserverUser,
  unbindJumpserverUser,
  upsertJumpserverMapping,
  type JumpserverCatalogItem,
} from "../services/api";
const { Title, Text } = Typography;

export default function JumpserverAccessPage() {
  const { permissions } = useContext(AuthContext);
  const admin = permissions.includes("jumpserver:config:manage");
  const [loading, setLoading] = useState(false),
    [status, setStatus] = useState<any>(null),
    [diag, setDiag] = useState<any>(null),
    [cfg, setCfg] = useState<any>({
      mappings: [],
      userBindings: [],
    }),
    [users, setUsers] = useState<any[]>([]),
    [remoteUsers, setRemoteUsers] = useState<JumpserverCatalogItem[]>([]),
    [assets, setAssets] = useState<JumpserverCatalogItem[]>([]),
    [nodes, setNodes] = useState<JumpserverCatalogItem[]>([]);
  const load = async () => {
    setLoading(true);
    try {
      setStatus(await getMyJumpserverStatus());
      if (admin) {
        setDiag(await diagnoseJumpserver());
        const [c, u, ru, a, n] = await Promise.all([
          getJumpserverConfiguration(),
          getAccessUsers(),
          getJumpserverCatalog("users"),
          getJumpserverCatalog("assets"),
          getJumpserverCatalog("nodes"),
        ]);
        setCfg(c);
        setUsers(u || []);
        setRemoteUsers(ru.items);
        setAssets(a.items);
        setNodes(n.items);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const launch = async () => {
    try {
      setLoading(true);
      const p = await prepareJumpserverPortal();
      const r = await consumeJumpserverPortal(p.ticket);
      window.open(r.portalUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      message.error(e?.response?.data?.message || "无法进入 JumpServer");
    } finally {
      setLoading(false);
    }
  };
  const openMapping = () => {
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
            options={users.map((u) => ({
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
            options={remoteUsers.map((u) => ({
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
        await load();
      },
    });
  };
  const openUserGrant = () => {
    let dashboardUserId = 0,
      target = "";
    const mappedUserIds = new Set(
      cfg.mappings
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
            options={users
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
              ...assets.map((x) => ({
                value: `ASSET|${x.id}|${x.name}`,
                label: `资产 · ${x.name}`,
              })),
              ...nodes.map((x) => ({
                value: `NODE|${x.id}|${x.name}`,
                label: `节点 · ${x.name}`,
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
        await load();
      },
    });
  };
  const revokeBundle = (binding: any) =>
    Modal.confirm({
      title: "确认回收用户资产授权？",
      content: `将回收 ${binding.dashboard_username} 的“${binding.bundle_name}”授权。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        await unbindJumpserverUser(
          Number(binding.bundle_id),
          Number(binding.dashboard_user_id),
        );
        await syncJumpserverUser(Number(binding.dashboard_user_id));
        message.success("用户授权已回收并同步到 JumpServer");
        await load();
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
        await load();
      },
    });
  const adminPanel = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card title="Provider 诊断">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Reader">
            {diag?.reader?.ok ? (
              <Tag color="green">正常 · {diag.reader.username}</Tag>
            ) : (
              <Tag color="red">异常</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Grant Manager">
            {diag?.grant?.ok ? (
              <Tag color="green">正常 · {diag.grant.username}</Tag>
            ) : (
              <Tag color="red">异常</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card
        title="身份映射"
        extra={<Button onClick={openMapping}>新增映射</Button>}
      >
        <Table
          rowKey="id"
          pagination={false}
          dataSource={cfg.mappings}
          columns={[
            { title: "运维系统用户", dataIndex: "dashboard_username" },
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
          <Button type="primary" onClick={openUserGrant}>
            新增授权
          </Button>
        }
      >
        <Table
          rowKey={(row: any) => `${row.dashboard_user_id}:${row.bundle_id}`}
          pagination={false}
          dataSource={cfg.userBindings.filter(
            (binding: any) => Number(binding.enabled) === 1,
          )}
          columns={[
            { title: "运维系统用户", dataIndex: "dashboard_username" },
            {
              title: "资产范围",
              dataIndex: "targets",
              render: (targets: string[]) =>
                (targets || []).map((target) => (
                  <Tag key={target}>
                    {target.split(":").slice(0, 2).join(":")}
                  </Tag>
                )),
            },
            {
              title: "账号 / 协议",
              render: (_, row: any) =>
                `${(row.accounts || []).join(", ")} / ${(row.protocols || []).join(", ")}`,
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
        <Button loading={loading} onClick={load}>
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
              <Tag key={g.bundleId}>
                {g.bundleName}: {g.status}
              </Tag>
            )) || "-"}
          </Descriptions.Item>
        </Descriptions>
        <Button
          type="primary"
          disabled={!status?.eligible}
          loading={loading}
          onClick={launch}
        >
          进入 JumpServer
        </Button>
      </Card>
      {admin && (
        <Tabs
          items={[{ key: "admin", label: "授权管理", children: adminPanel }]}
        />
      )}
    </div>
  );
}
