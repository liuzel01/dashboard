/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useContext, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
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
  bindJumpserverRole,
  consumeJumpserverPortal,
  createJumpserverBundle,
  diagnoseJumpserver,
  getAccessUsers,
  getJumpserverCatalog,
  getJumpserverConfiguration,
  getMyJumpserverStatus,
  prepareJumpserverPortal,
  syncJumpserverUser,
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
    [cfg, setCfg] = useState<any>({ mappings: [], bundles: [], roles: [] }),
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
  const openBundle = () => {
    let name = "",
      target = "",
      roleId = 0;
    Modal.confirm({
      width: 620,
      title: "创建授权包",
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="授权包名称"
            onChange={(e) => (name = e.target.value)}
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
          <Select
            placeholder="绑定自定义角色"
            style={{ width: "100%" }}
            options={cfg.roles.map((r: any) => ({
              value: r.id,
              label: r.name,
            }))}
            onChange={(v) => (roleId = v)}
          />
          <Alert
            type="warning"
            showIcon
            message="第一版默认允许该范围的 @ALL 账号与 ssh 协议；创建后请在 JumpServer 核对实际账号范围。"
          />
        </Space>
      ),
      onOk: async () => {
        if (!name || !target || !roleId) throw new Error("请完整填写");
        const [type, id, ...rest] = target.split("|");
        const b = await createJumpserverBundle({
          name,
          targets: [
            { type: type as "ASSET" | "NODE", id, name: rest.join("|") },
          ],
          accounts: ["@ALL"],
          protocols: ["ssh"],
        });
        await bindJumpserverRole(b.id, roleId);
        message.success("授权包和角色绑定已创建");
        await load();
      },
    });
  };
  const sync = (id: number) =>
    Modal.confirm({
      title: "确认同步远端授权？",
      content:
        "将根据用户当前角色创建或回收 Dashboard 受管的 JumpServer Asset Permission。",
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
      {cfg.bundles.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message="尚未创建授权包"
          description="身份映射不会自动授予资产权限。请先创建授权包并绑定运维系统角色，再为对应用户执行授权同步。"
        />
      )}
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
        title="授权包与自定义角色"
        extra={
          <Button type="primary" onClick={openBundle}>
            创建授权包
          </Button>
        }
      >
        <Table
          rowKey="id"
          pagination={false}
          dataSource={cfg.bundles}
          columns={[
            { title: "授权包", dataIndex: "name" },
            {
              title: "目标",
              dataIndex: "targets",
              render: (v: string[]) =>
                (v || []).map((x) => (
                  <Tag key={x}>{x.split(":").slice(0, 2).join(":")}</Tag>
                )),
            },
            {
              title: "角色",
              dataIndex: "roles",
              render: (v: string[]) =>
                (v || []).map((x) => (
                  <Tag key={x}>{x.split(":").slice(1).join(":")}</Tag>
                )),
            },
            {
              title: "协议",
              dataIndex: "protocols",
              render: (v: string[]) => (v || []).join(", "),
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
          <Text type="secondary">角色授权与远端实际权限双重校验</Text>
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
