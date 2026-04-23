# dashboard 菜单「查询中心」改版方案（Gateway 模式：ConfigMap 取密文 + Agent 解密 + 缓存）

## 1. 背景与目标

当前中心 `dashboard` 后端与各环境 DB 网络通常不直通，且部分 RDS/Redis/Mongo 仅对白名单网段开放。

已确认每个目标 EKS 环境内存在可访问数据库的网络路径，因此本次采用 **Gateway 模式**：

- 在每个环境 EKS 内部署 `dashboard-db-gateway-agent`
- Agent 本地读取该环境专用 ConfigMap（密文配置）
- Agent 本地解密并缓存连接参数
- 中心 `dashboard` 后端仅调用 Agent API，不直接连数据库

---

## 2. 方案边界

### 2.1 本次纳入

- 查询中心改为“中心后端 -> 环境内 Agent”调用链路
- Agent 实现 ConfigMap 读取、解密、缓存、受控查询
- `environmentId` 路由到对应 Agent
- 最小可观测与错误码规范

### 2.2 本次不纳入

- 多租户连接池隔离
- SQL 审批流与复杂审核引擎
- Secret Manager / External Secrets 迁移
- 前端大改版

---

## 3. 当前现状与关键结论

1. 当前已 apply 的 `dashboard-db-gateway-agent.yaml` 先作为环境侧部署基线。
2. 若容器仅为 `ubuntu + sleep infinity`，它是工具 Pod，不是可调用网关服务；要走 Gateway 模式必须替换为真实 Agent 应用镜像。
3. ConfigMap 中密文字段读取后必须先解密才能用于建连。
4. `serviceAccountName: kms-app-sa` 可复用，但必须核验 K8s RBAC 与 KMS 解密权限。

---

## 4. 目标架构（Gateway 模式）

`前端 -> dashboard 后端 -> (按 environmentId 路由) -> dashboard-db-gateway-agent -> ConfigMap(密文) -> 解密 -> DB/Redis/Mongo`

设计原则：

- 中心后端不保存各环境明文连接信息
- Agent 与目标数据库处于可达网络
- 写操作默认关闭，按白名单能力逐步开放

---

## 5. Agent 职责拆分

1. `DbConfigResolver`
   - 按约定读取本环境专用 ConfigMap 键（如 `datasource.url`、`datasource.password`、`redis.*`、`mongo.uri`）
2. `DbCredentialDecryptor`
   - 调用现网同款解密逻辑（KMS 或现有算法）
3. `ConnectionFactory`
   - 构造 MySQL/Redis/Mongo 客户端连接参数
4. `ConfigCache`
   - 短 TTL 缓存（建议 3~5 分钟）
5. `QueryExecutor`
   - 执行受控查询（默认只读）
6. `AuditLogger`
   - 记录调用方、环境、SQL 摘要、耗时、结果码

---

## 6. 接口约定（中心后端 <-> Agent）

建议最小接口：

1. `GET /healthz`
   - Agent 进程健康与依赖探活
2. `POST /v1/query/aggregate`
   - 查询中心聚合查询入口
3. `POST /v1/query/sql/preview`（可选）
   - 只读 SQL 预览执行，限制 `LIMIT`
4. `POST /v1/query/sql/execute`（默认关闭）
   - 写操作开关，需额外鉴权与白名单

通用请求头：

- `X-Environment-Id`
- `X-Request-Id`
- `X-Agent-Token`（中心后端与 Agent 共享令牌）

---

## 7. 配置模型（建议）

Agent 专用 ConfigMap（每环境一份）：

- `datasource.url`
- `datasource.username`
- `datasource.password`（当前阶段允许密文；后续建议迁移 Secret）
- `redis.host`
- `redis.port`
- `redis.database`
- `redis.ssl`
- `redis.password`
- `mongo.uri`

说明：

- 当前约束下可先放“加密后的密文值”到 ConfigMap，由 Agent 运行时解密。
- 后续可演进为“非敏感放 ConfigMap，敏感放 Secret”。

---

## 7.1 关键环境变量说明（精简后）

> 目标：统一走 `dashboard-db-gateway-agent`，不再依赖环境配置中的 `database_json/redis_json` 直连信息。

### 中心后端（Query Center）

- `QUERY_CENTER_GATEWAY_ENABLED`：是否开启网关转发。
- `QUERY_CENTER_GATEWAY_TIMEOUT_MS`：转发到 agent 的超时。
- `QUERY_CENTER_GATEWAY_ENV_ALLOWLIST` / `QUERY_CENTER_GATEWAY_ENV_DENYLIST`：按环境灰度控制（可为空）。
- `QUERY_CENTER_GATEWAY_TRANSPORT`：`k8s-proxy` 或 `direct-url`（当前推荐 `k8s-proxy`）。
- `QUERY_CENTER_AGENT_K8S_NAMESPACE` / `QUERY_CENTER_AGENT_K8S_SERVICE` / `QUERY_CENTER_AGENT_K8S_PORT`：k8s-proxy 模式下的目标服务定位。
- `QUERY_CENTER_AGENT_TOKEN`：与 agent 侧 `AGENT_SHARED_TOKEN` 对齐。

### 环境侧 Agent

- `AGENT_ENVIRONMENT_ID`：单环境 agent 的默认环境标识（建议与部署环境一致）。
- `AGENT_SHARED_TOKEN`：agent 鉴权令牌。
- `AGENT_DECRYPT_PROVIDER`：解密提供方（如 `kms`）。
- `KMS_KEY_ALIAS` / `KMS_CONTEXT`：当前单环境部署的 KMS 解密参数。
- `AGENT_KMS_VALUE_PREFIX` / `AGENT_KMS_DECRYPT_TIMEOUT_MS`：解密行为控制参数。
- `CONFIG_CACHE_TTL_MS`：解密后连接配置缓存 TTL。
- `QUERY_TIMEOUT_MS`：agent 内部查询超时。
- `DB_MYSQL_URL` / `DB_MYSQL_USER` / `DB_MYSQL_PASSWORD`：MySQL 连接参数。
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_DATABASE` / `REDIS_SSL` / `REDIS_PASSWORD`：Redis 连接参数。
- `MONGO_URI`：Mongo 连接参数（当前聚合查询仍保留字段，后续可按功能启用）。

### 已下线/不再推荐

- `QUERY_CENTER_GATEWAY_STRICT`：代码未实际使用，已移除。
- `AGENT_DECRYPT_ENV_CONFIGS`：当前按“单 agent 对应单环境”策略，先移除环境映射配置，统一使用 `KMS_KEY_ALIAS + KMS_CONTEXT`。

## 8. 权限与前提

### 8.1 Kubernetes

- 若 Agent 用环境变量注入 ConfigMap：通常不需额外 `Role/RoleBinding`。
- 若 Agent 代码主动调用 K8s API 读 ConfigMap：需要最小 RBAC（`configmaps.get`）。

### 8.2 AWS / KMS

- `kms-app-sa` 绑定的 IAM Role 需具备 `kms:Decrypt`。
- KMS key policy 需允许对应 IAM Role 调用解密。

### 8.3 网络

- Agent 所在 Pod 网段/安全组必须可达 RDS/Redis/Mongo。
- 这是 Gateway 模式可用的必要条件。

---

## 9. 数据流（时序）

1. 前端调用中心 `dashboard` 查询接口，携带 `environmentId`
2. 中心后端按 `environmentId` 定位目标 Agent 地址
3. Agent 读取（或命中缓存）ConfigMap 密文配置
4. Agent 执行解密，得到明文连接参数
5. Agent 建连并执行查询
6. Agent 返回去敏结果给中心后端
7. 中心后端原样返回前端

统一错误码（建议）：

- `AGENT_UNREACHABLE`
- `CONFIGMAP_NOT_FOUND`
- `CONFIG_KEY_MISSING`
- `DECRYPT_FAILED`
- `DB_CONNECT_FAILED`
- `QUERY_EXEC_FAILED`
- `WRITE_DISABLED`

---

## 10. 安全与合规

1. 禁止日志输出明文密码/完整连接串
2. 解密结果仅驻留内存，禁落盘
3. 默认只读；写接口需显式开关 + 审计
4. 所有请求记录 `requestId`、调用人、环境、SQL 摘要、耗时
5. 对中心后端到 Agent 的访问启用令牌校验（`X-Agent-Token`）

---

## 11. 可观测性

关键日志维度：

- `environmentId`
- `agentPod`
- `configSource`
- 解密耗时、建连耗时、SQL耗时
- 错误码与阶段（read/decrypt/connect/query）

建议指标：

- `query_center_agent_request_total`
- `query_center_agent_error_total`
- `query_center_decrypt_success_total`
- `query_center_decrypt_fail_total`
- `query_center_query_latency_ms`

---

## 12. 验收标准（DoD）

1. 至少 2 个 environment 下 Agent 可完成“读 ConfigMap -> 解密 -> 查询”
2. 中心后端通过 Agent 返回结果，不再直连目标数据库
3. 敏感信息不落日志
4. 配置缺失/权限不足/解密失败/建连失败均返回明确错误码
5. 非查询中心菜单功能不受影响

---

## 13. 实施计划

### Phase 1：Gateway 落地基线

- 确认每环境 Agent 部署、Service 可达、SA 权限与网络白名单
- 固化 ConfigMap 字段规范（`datasource.*`、`redis.*`、`mongo.uri`）

### Phase 2：Agent 应用实现

- 实现读取 ConfigMap、解密、缓存、建连、只读查询
- 提供 `/healthz` 与 `/v1/query/aggregate`
- 接入审计日志与错误码

### Phase 3：中心后端接入

- 按 `environmentId` 路由 Agent
- 保持前端接口不变
- 兼容灰度与快速回滚

### Phase 4：联调与灰度

- 先在测试环境验证链路
- 观察解密失败率、连接失败率、查询延迟
- 分环境逐步放量

---

## 14. 风险与应对

1. **风险：Agent 镜像不是应用镜像（仅工具 Pod）**
   - 应对：提供真实 agent 应用镜像并加健康探针
2. **风险：解密逻辑与现网不一致**
   - 应对：复用现网同库同参数，先做样例对照
3. **风险：SA / KMS 权限不足**
   - 应对：最小权限补齐并做预检查脚本
4. **风险：ConfigMap 字段不统一**
   - 应对：建立环境映射与 schema 校验
5. **风险：连接抖动影响体验**
   - 应对：短 TTL 缓存 + 连接池 + 超时重试

---

## 15. 后续优化（本次不做）

- 密文从 ConfigMap 迁移到 Secret/External Secrets
- 写操作审批与细粒度授权
- SQL 模板白名单、预算控制（行数/时长/频率）
- Agent 多副本与故障转移

---

## 16. 结论

在当前网络约束下，Gateway 模式是可行且更稳妥的路径。

本次落地重点：

1) 每环境部署可用的 `dashboard-db-gateway-agent` 应用；
2) Agent 内完成 `ConfigMap(密文) -> 解密 -> 缓存 -> 查询`；
3) 中心后端仅做路由与聚合，不直接触达目标数据库。

---

## 17. 可执行任务清单（按角色拆分）

以下任务按“可直接开工”粒度拆分，默认顺序为 `A -> B -> C -> D`。

### A. Agent 服务开发（环境侧）

- [x] A1. 建立 `dashboard-db-gateway-agent` 应用入口（独立模块/独立启动命令）
  - 产出：可运行的 agent 进程，暴露 `/healthz`
- [x] A2. 实现 ConfigMap 配置读取器
  - 范围：读取 `datasource.*`、`redis.*`、`mongo.uri`
  - 产出：配置解析 DTO + schema 校验 + 缺失字段错误码
- [x] A3. 实现解密器
  - 范围：接入现网同款解密逻辑（KMS 或现有算法）
  - 产出：`DECRYPT_FAILED` 分类错误与日志去敏
- [x] A4. 实现连接工厂与缓存
  - 范围：MySQL/Redis/Mongo 建连，配置缓存 TTL（默认 3~5 分钟）
  - 产出：缓存命中/失效日志，连接失败错误码
- [x] A5. 实现查询接口 `POST /v1/query/aggregate`
  - 范围：默认只读，超时控制，基础输入校验
  - 产出：统一响应结构与错误码
- [x] A6. 实现 Agent 鉴权
  - 范围：`X-Agent-Token` 校验
  - 产出：未授权返回 401，审计日志包含 requestId
- [ ] A7. 补齐单元测试与最小集成测试
  - 产出：配置缺失/解密失败/建连失败/查询成功覆盖

### B. 中心 dashboard 后端改造

- [x] B1. 新增 `environmentId -> agent endpoint` 路由配置
  - 产出：每环境 agent 地址配置项（DB 表或配置文件）
- [x] B2. 查询中心接入 agent 调用客户端
  - 范围：原接口不变，内部改为转调 agent
  - 产出：`AGENT_UNREACHABLE` 等错误码映射
- [x] B3. 请求链路透传
  - 范围：透传 `X-Environment-Id`、`X-Request-Id`、`X-Agent-Token`
  - 产出：端到端 requestId 可追踪
- [x] B4. 回退开关
  - 范围：保留 feature flag（gateway on/off）
  - 产出：灰度失败可快速回滚
- [ ] B5. 兼容前端与现有权限
  - 范围：前端不改接口；后端权限模型不退化
  - 产出：现网功能不受影响

### C. 运维与发布（每环境）

- [ ] C1. 固化每环境专用 ConfigMap 字段与值来源
  - 产出：环境配置登记表（env -> cm name -> key）
- [ ] C2. 核验 `kms-app-sa` 权限
  - 范围：IRSA、`kms:Decrypt`、KMS key policy
  - 产出：权限核验记录
- [x] C3. 构建并发布 agent 镜像
  - 范围：替换工具镜像（`ubuntu + sleep infinity`）为真实应用镜像
  - 产出：镜像 tag 与回滚 tag
- [x] C4. 部署与探活
  - 范围：Deployment/Service/探针，确认 `/healthz` 正常
  - 产出：`kubectl get pods/svc` 与探活记录
- [ ] C5. 网络与白名单核验
  - 范围：Pod 到 RDS/Redis/Mongo 的连通性
  - 产出：连通性验证记录（端口级）

### D. 联调与验收

- [x] D1. 场景 1：配置正确 + 解密成功 + 查询成功
  - 验收：2 个以上 environment 成功返回
- [ ] D2. 场景 2：ConfigMap 缺失或字段缺失
  - 验收：返回 `CONFIGMAP_NOT_FOUND` / `CONFIG_KEY_MISSING`
- [ ] D3. 场景 3：解密失败
  - 验收：返回 `DECRYPT_FAILED`，日志无明文
- [ ] D4. 场景 4：数据库不可达
  - 验收：返回 `DB_CONNECT_FAILED`
- [ ] D5. 场景 5：agent 不可达
  - 验收：中心后端返回 `AGENT_UNREACHABLE` 且可观测
- [ ] D6. 回归检查
  - 验收：非查询中心菜单能力不受影响

### E. 上线门禁（Go/No-Go）

- [ ] E1. 只读默认开启，写接口默认关闭
- [ ] E2. 敏感信息去敏验证通过
- [ ] E3. 指标面板可观察：请求量、失败率、延迟、解密失败率
- [ ] E4. 回滚预案演练通过（feature flag 或回退旧链路）
- [ ] E5. 值班与告警责任人确认

### F. 建议排期（可调整）

- 第 1 天：A1~A3、B1
- 第 2 天：A4~A6、B2~B4
- 第 3 天：A7、C1~C4
- 第 4 天：C5、D1~D6、E1~E5
