# 2026-05-03 线路新增向导（Step4）Ingress 克隆发布 MVP 方案

## TL;DR

在 `新增线路` 菜单第4步（ingress 文件复制并应用）引入与“查询中心”一致的链路：

- 前端只提交业务参数
- 后端新增受控 API
- 后端通过既有 gateway client 调用运行在 EKS 内的 `dashboard-db-gateway-agent`
- 在集群内执行 ingress 模板克隆 + host 替换 + apply

该方案可替代“手动连跳板机 + 手工 kubectl”，并保证权限边界、审计能力与可回归性。

---

## 1. 背景与目标

### 1.1 背景

当前项目已有能力通过 `dashboard-db-gateway-agent` 访问 EKS 内部服务（典型：`查询中心` 用户查询相关功能）。

`新增线路` 第4步目前仍偏手工，存在：

- 依赖人工登录环境执行
- 操作一致性差
- 审计与回放弱

### 1.2 本次目标（MVP）

在 `新增线路` 第4步支持：

1. 选定一个模板 ingress（例：`nginx-web-app`）
2. 自动生成新 ingress 名（时间戳）
3. 将 ingress host 替换为前序步骤生成的目标 host
4. 在目标集群/命名空间创建新 ingress

> 关键约束：第4步使用的 `newHost` 必须来源于同一次“新增线路”流程中第2步（根据步骤1域名生成线路子域名）的输出，不允许在第4步手工随意输入其他 host（MVP 阶段）。

### 1.3 非目标（MVP 不包含）

- 通用 YAML 在线编辑器
- 跨 namespace/跨集群批量发布
- 复杂证书生命周期编排（仅保留模板继承）

---

## 2. 现有链路回顾（已对齐）

“查询中心”已使用如下模式：

- 前端：调用后端 `/query/*`
- 后端：`QueryController/QueryService`
- 后端网关客户端：`QueryGatewayClientService`
- 目标：`dashboard-db-gateway-agent`（k8s service proxy / direct url）

本方案复用同一设计哲学：

- 控制面统一在后端
- 集群内执行由 agent 承担
- 前端不直连 agent，不直接传递任意 YAML

---

## 3. 推荐方案与判定

### 3.1 推荐方案（首选）

新增后端 API（Line Onboarding 域），由后端再调 agent 完成 ingress clone/apply。

### 3.2 为什么不是前端直调 agent

- 安全风险：前端参数可被篡改，难做强约束
- 审计缺口：难统一记录操作者与结果
- 可维护性差：业务规则散落前端，难演进

### 3.3 为什么不是继续手工 kubectl

- 不可规模化
- 可重复性差
- 难做标准化失败处理

---

## 4. MVP 范围（可执行）

### 4.1 API 合同（建议）

`POST /line-onboarding/ingress/clone`

请求：

```json
{
  "environmentId": "hashex",
  "namespace": "default",
  "sourceIngressName": "nginx-web-app",
  "newHost": "new-host.example.com"
}
```

说明：

- `newHost` 由第2步“根据步骤1域名生成线路子域名”产出并传入。
- MVP 中后端应校验该 `newHost` 与当前流程上下文一致（至少校验格式、来源字段存在；若有流程会话ID则校验绑定关系）。

响应：

```json
{
  "success": true,
  "data": {
    "newIngressName": "nginx-web-app-2605032007",
    "namespace": "default",
    "host": "new-host.example.com"
  }
}
```

### 4.2 关键业务规则（必须）

1. 新名称按模板名前缀 + 时间戳生成（冲突自动补后缀）
2. 仅允许替换白名单字段：
   - `metadata.name`
   - `spec.rules[*].host`
   - `spec.tls[*].hosts`（若存在）
3. 禁止透传任意 metadata/spec patch（MVP）

### 4.3 克隆时需剔除字段

- `metadata.uid`
- `metadata.resourceVersion`
- `metadata.generation`
- `metadata.creationTimestamp`
- `metadata.managedFields`
- `metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]`
- `status`

### 4.4 冲突与错误码

- 模板 ingress 不存在：`404`
- 新 ingress 名已存在：`409`
- host 已被占用：`409`
- 参数非法（host/name/env）：`400`

---

## 5. 安全、审计与可观测性

### 5.1 安全边界

- namespace 需受控（白名单或环境配置映射）
- environmentId 与 kubeContext 必须可追踪绑定
- 禁止执行任意 kubectl 子命令（仅限定 ingress clone path）

### 5.2 审计日志（后端）

每次操作记录：

- `requestId`
- 操作者（userId/username）
- environmentId / namespace
- sourceIngressName / newIngressName
- newHost
- 结果（success/fail）与错误摘要

### 5.3 可观测性

- 记录 agent 耗时、重试、失败类型
- UI 显示可读错误（冲突原因、占用对象）

---

## 6. 失败处理与回滚

### 6.1 MVP 失败策略

- 创建前校验失败：直接返回（不执行 apply）
- apply 失败：返回失败详情（不吞错）
- 若出现“已创建但后续验证失败”：返回 warning（后续版本可追加自动清理）

### 6.2 后续增强（非 MVP）

- 幂等键（同请求多次提交防重）
- 自动回滚/补偿删除
- 变更审批/二次确认

---

## 7. 开发前待拍板项（必须先确认）

1. **namespace 策略**
   - A：固定 `default`
   - B：由 environment 配置决定（推荐）（已确认现存的环境的 EKS集群内业务服务都放在 ns: default内，所以可以采用的方案： 默认使用ns: default, 除非在 environment配置中另外指明namespace）

2. **TLS 策略**
   - A：仅替换 host，TLS 配置原样继承（MVP 推荐）（可以用此方案）
   - B：替换 host 同步检查/改写 cert 相关 annotation

3. **命名策略细节**
   - 时间戳格式（建议 `YYMMDDHHmm`）
   - 冲突后缀（随机2位）（可以在后缀额外加： 随机4位）

4. **host 唯一性范围**
   - 仅同 namespace
   - 还是同集群全局（推荐：集群全局）（可以用此方案）

---

## 8. DoD（MVP 验收标准）

1. UI 第4步可一键创建新 ingress
2. `kubectl get ingress -n <ns>` 可见新 ingress
3. 新 ingress host 与目标一致
4. 原模板 ingress 无变更
5. 重复 host/name 得到明确 `409` 错误提示
6. 后端日志可按 requestId 追溯整条链路

---

## 9. 推荐执行方式（Harness Coding MVP）

采用小步快跑：

- Phase 1：后端 API + gateway client 扩展 + 单元测试
- Phase 2：前端 Step4 接入 + 错误提示优化
- Phase 3：联调验证（hashex）+ 文档补全

每阶段要求：

- 可独立验证
- 可回滚
- 保留最小可运行状态

---

## 10. 建议的下一步

在上述“待拍板项”确认后，生成一份可直接投喂 coding harness 的任务说明（含文件级改动列表、接口定义、测试清单、回归项）。

---

## 10.1 当前实现进展（2026-05-04 更新）

### 已实现（代码落地）

1. 后端新增 ingress 克隆接口：`POST /api/lines/ingress/clone`
2. 后端新增 source ingress 候选接口：`POST /api/lines/ingress/source-candidates`
3. 后端保留自动解析接口：`POST /api/lines/ingress/resolve-source`
4. Step4 执行面已迁移到 `dashboard-db-gateway-agent`：
   - 前端只调用 dashboard backend
   - backend 通过 Kubernetes service proxy 调用集群内 `dashboard-db-gateway-agent`
   - agent 使用 in-cluster Kubernetes client 读取/创建 ingress
5. 后端/agent 参数校验与错误码分支：400 / 404 / 409
6. agent ingress 克隆核心逻辑：
   - source ingress 读取
   - host 全集群冲突检查
   - 新 ingress name 使用前端确认/修改后的 `newIngressName`
   - namespace 内同名 ingress 冲突返回 409，不再静默追加随机后缀
   - 清理不可复用字段（uid/resourceVersion/generation/managedFields/status/last-applied 等）
   - 替换 `metadata.name`、`spec.rules[*].host`、`spec.tls[*].hosts`
7. 前端新增接口调用封装：
   - `getIngressSourceCandidatesForLineOnboarding`
   - `resolveIngressSourceForLineOnboarding`
   - `cloneIngressForLineOnboarding`
8. 前端 Step4 改造为：
   - 点击“加载 source ingress 候选”
   - 默认按关键字 `nginx-web-app` 筛选候选
   - 候选按创建时间倒序展示
   - 用户手动选择 source ingress
   - 系统按 `nginx-web-app-{host前缀}-{YYMMDDHHmm}` 生成默认新 ingress name
   - 用户可确认或修改新 ingress name 后再执行 clone
9. 前端 Step4 按钮触发条件放宽为仅依赖 `confirmedSubdomain`（便于联调，不强依赖 dcdnConfirmed）

### 已完成验证（可审查）

1. 400 场景（参数错误）已验证
2. 404 场景（模板 ingress 不存在）已验证
3. 409 场景（host 已存在冲突）已验证
4. 201 场景（创建成功）已在页面联调中验证

### 当前状态说明

- MVP 主链路已可用：前端 Step4 可通过 `dashboard-db-gateway-agent` 在目标 EKS 集群内创建新 ingress，并可收到成功/冲突反馈。
- 原先“后端通过本机 kubeconfig 直连 Kubernetes API”的架构偏差已修正；当前链路为：`frontend -> dashboard backend -> Kubernetes service proxy -> dashboard-db-gateway-agent -> Kubernetes API`。
- 当前 Step4 不再依赖仓库固定 YAML 模板，也不再固定直接克隆 `nginx-web-app`；而是由用户从候选列表中显式选择 source ingress。
- 如果各 environment/租户使用的线路 ingress 命名均包含 `nginx-web-app`，则当前“按 `nginx-web-app` 关键字加载 source ingress 候选 + 人工选择”的方案已可覆盖主要场景；“从租户已有启用线路 lineUrl 精确反查 ingress”可从必需任务降级为后续增强。
- 仍建议在后续回归中补强：
  - requestId 维度的完整日志留存示例
  - `kubectl get ingress` 验证截图/命令结果沉淀

---

## 11. 后续优化章节（DoD 后优先）

> 目标：解决“不同 environment / 不同租户对应 ingress 不一致”导致的模板失配问题，去除固定模板文件依赖。

### 11.1 结论（优化方向）

当前已完成从“固定模板文件（仓库内 YAML）”到“环境内选择 source ingress 并克隆”的切换：

- 已不依赖 `deploy/k8s/*.yaml` 作为统一模板源。
- 已支持通过 agent 从目标 environment 内加载 source ingress 候选。
- 已支持人工选择 source ingress 后执行 clone + host 替换。
- 已支持用户确认/修改新 ingress name。

若各 environment/租户的线路 ingress 命名都包含统一关键字（当前为 `nginx-web-app`），当前候选筛选方案可满足快速上线与可控发布。基于租户已启用 lineUrl 的自动精确反查仍有价值，但不再是 Step4 可用性的硬前置。

### 11.2 当前推荐流程（已实现）

输入：`environmentId + namespace + keyword(默认 nginx-web-app)`

执行顺序：

1. **加载候选**：前端调用 `POST /api/lines/ingress/source-candidates`，backend 转发 agent，agent 在目标集群内 list ingress。
2. **关键字筛选**：默认按 `nginx-web-app` 匹配 namespace/name/ruleHosts。
3. **候选排序**：按 ingress `creationTimestamp` 倒序返回，最近创建的候选排在前面。
4. **人工选择 source ingress**：前端下拉展示候选，由用户显式选择 source ingress。
5. **确认新 ingress name**：系统默认生成 `nginx-web-app-{host前缀}-{YYMMDDHHmm}`，用户可修改。
6. **执行 clone**：以用户选择的 source ingress 执行 clone，将 host 替换为 Step2 生成的新 host。

### 11.2.1 后续增强（可选，不再阻塞当前上线）

输入：`environmentId + tenantId + lineUrl(可选)`

增强流程：

1. **优先精确匹配 host**：用租户已有启用线路 `lineUrl` 的 host 在该集群 ingress 规则中精确匹配（cluster-wide）。
2. **次级规则匹配**：若精确匹配失败，尝试关键字/候选匹配。
3. **人工兜底选择**：若仍失败，前端弹出候选列表供人工选择 source ingress。
4. **确认并克隆**：以最终 source ingress 执行 clone，替换为 Step2 生成的新 host。

判断：如果现有 ingress 命名规范能保证“租户线路 ingress 均可通过 `nginx-web-app` 关键字筛出”，则该增强可作为体验优化，而非必需开发项。

### 11.3 命名策略（当前实现）

当前默认新 ingress name：

`nginx-web-app-{host前缀}-{YYMMDDHHmm}`

示例：

- 目标 host：`l01-test.mgdevlab.com`
- 默认新 ingress name：`nginx-web-app-l01-test-2605041607`

策略：

- 前端生成默认 name，并展示给用户确认。
- 用户可按实际规范手工修改。
- 后端/agent 校验 Kubernetes resource name 格式。
- namespace 内同名冲突返回 `409`，不再静默追加随机后缀，避免创建用户未确认过的资源名。

后续如命名规范进一步统一，可再做命名模板配置化（本阶段暂不做）。

### 11.4 与当前 MVP 的关系

- 当前 MVP 已从“固定 sourceIngressName”升级为“候选加载 + 人工选择 source ingress”。
- `sourceIngressName` 当前由用户从候选列表中确认，backend/agent 只接受受控 clone 参数，不接受任意 YAML/patch。
- 自动解析 `sourceIngressName` 能力已保留为接口能力，但当前 Step4 主交互以人工确认为准，降低误克隆风险。

### 11.5 当前接口

1. `POST /api/lines/ingress/source-candidates`
   - 入参：`environmentId`, `namespace`, `keyword?`
   - 出参：`items[]`（namespace/name/ruleHosts/lbAddresses/createdAt）
   - 用途：人工选择 source ingress 的候选列表。

2. `POST /api/lines/ingress/resolve-source`
   - 入参：`environmentId`, `namespace`, `lineUrl?`, `keyword?`
   - 出参：`sourceIngressName`, `namespace`, `matchedBy`, `candidates`
   - 用途：自动解析 source ingress 的保留能力，当前不是 Step4 主交互。

3. `POST /api/lines/ingress/clone`
   - 入参：`environmentId`, `namespace`, `sourceIngressName`, `newHost`, `newIngressName?`
   - 出参：`newIngressName`, `namespace`, `host`, `sourceIngressName`
   - 用途：以用户确认的 source ingress 与 newIngressName 创建新 ingress。

### 11.6 风险点与补充改进

1. **lineUrl 到 ingress 映射歧义**
   - 同 host 可能在多 namespace/多 ingress 中出现（历史遗留）。
   - 处理：返回冲突候选并要求人工确认，不要盲选。

2. **tenantCode 来源统一性**
   - 命名中用到 `<tenantCode>`，需明确来源字段（租户英文名/租户简称/tenantId 映射）。
   - 处理：新增统一解析函数，避免各页面各自拼接。

3. **跨环境误用风险**
   - 解析 source ingress 时必须强绑定 `environmentId` 的 kubeContext。
   - 处理：后端强校验 header 与 body 环境一致，日志记录 env/context。

4. **可回溯性要求**
   - 增加 `resolve-source` 结果日志（matchedBy、候选数量、最终选择）以便排障。

### 11.7 优化验收标准（新增）

1. 不依赖仓库固定 ingress 模板文件也可完成 Step4。
2. 在 hashex/hashdev 等不同环境均可加载 source ingress 候选。
3. source ingress 候选按创建时间倒序展示。
4. 用户可人工选择 source ingress 并成功发布。
5. 新 ingress name 可确认/修改，且同名冲突返回明确 `409`。
6. 全链路日志可追踪：候选加载 + 克隆动作 + 最终结果。

### 11.8 当前剩余任务

1. 验收证据沉淀（暂缓）：补充 `kubectl get/describe ingress`、host/name 409、source ingress 未变更等证据。
2. requestId 审计样例（待补强）：确认 backend -> gateway client -> agent 日志中 requestId/userId/username 是否完整贯通。
3. 自动 source 推荐（可选增强）：如后续需要减少人工选择，可基于 tenantId/已启用 lineUrl 做 host 精确反查；在当前 `nginx-web-app` 命名规范可覆盖候选筛选的前提下，该项不是必需上线任务。
4. 命名模板配置化（可选增强）：如团队后续统一命名规范，再支持模板配置；当前先使用默认生成 + 人工修改。
