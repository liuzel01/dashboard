# 2026-05-04 新增线路 Step6 tenant_domain 自动写入方案

## TL;DR

Step6 已从“仅输出 SQL 并人工执行”升级为可自动写入：`frontend -> dashboard backend -> dashboard-db-gateway-agent -> 环境 MySQL`。MVP 只做受控 INSERT，不做 UPDATE；同租户重复提交返回 `unchanged` 并提示“已存在，未重复写入”，跨租户/重复历史记录返回冲突并交由人工确认。

---

## 1. 当前现状

页面：`新增线路 -> 步骤6：在环境平台数据库新增 tenant_domain 数据`

当前实现：

- 前端根据步骤1租户与步骤2子域名生成 SQL 草稿。
- 支持复制 SQL。
- 支持点击“确认已完成执行 SQL”，设置前端状态 `sqlConfirmed = true`。
- 已新增自动写入能力：点击“自动写入 tenant_domain”后，backend 通过 `dashboard-db-gateway-agent` 写入环境 MySQL。
- 已实现幂等/冲突检查：新 domain 返回 `created`；同租户重复返回 `unchanged`；跨租户或重复历史记录返回 `409 conflict`。

当前 SQL 草稿：

```sql
INSERT INTO tenant_domain (tenant_id, domian, status, created_time)
VALUES ({tenantId}, '{confirmedSubdomain}', 1, NOW());
```

注意：字段名确认为数据库真实字段 `domian`，不是 `domain`。

---

## 2. hashdev 只读核对结果

连接信息来自 megadev-hashdev MySQL，只读检查结论：

- `tenant_domain` 表位于 schema：`tenant`
- 默认 `spot.tenant_domain` 不存在
- 表结构：

```sql
CREATE TABLE `tenant_domain` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `domian` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `status` tinyint(1) NOT NULL,
  `created_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
```

索引：

- 仅主键：`PRIMARY(id)`
- 当前数据库层面未看到 `domian` 或 `tenant_id + domian` 唯一索引。

样例数据：

```text
id=15 tenant_id=1 domian=hhts88.com status=1 created_time=2025-11-24 15:05:17 JST 左右
```

最新样例中也存在：

```text
www.faithbian.net
hashapp.rangya5.cn
www.hhts88.com
hhts88.com
l01.hashex.vip
```

---

## 3. 推荐架构

推荐链路：

```text
frontend
  -> dashboard backend: POST /api/lines/tenant-domain/apply
  -> Kubernetes service proxy
  -> dashboard-db-gateway-agent: POST /v1/tenant-domain/apply
  -> environment MySQL schema tenant
```

不推荐 dashboard backend 直连环境 MySQL，原因：

- agent 已承担环境内数据库访问能力，和查询中心/Step4 agent 化链路一致。
- 环境数据库凭据与网络边界应留在 agent/环境侧。
- backend 负责业务校验、审计、转发；agent 负责环境内执行。

---

## 4. MVP 写入策略

### 4.1 固定写入值

- `tenant_id`：取步骤1选择的租户 ID。
- `domian`：取步骤2确认子域名。
- `status`：固定写入 `1`。
- `created_time`：数据库 `NOW()` 或默认 `CURRENT_TIMESTAMP`。

说明：lineUrl 是否启用由超级管理端/其他业务系统决定，不由 `tenant_domain.status` 决定；Step6 新增数据 status 默认 1。

### 4.2 禁止 UPDATE

MVP 不做任何自动 UPDATE。

原因：

- 同一环境内 `domian` 业务上应唯一，不应被多租户重复使用。
- 如果发现重复或历史停用记录，应由人工确认，不应自动改写。
- 数据库当前没有唯一索引保护，应用层必须先查再插入，尽量降低误写风险。

### 4.3 幂等/冲突规则

执行前先查询：

```sql
SELECT id, tenant_id, domian, status, created_time
FROM tenant.tenant_domain
WHERE domian = ?
ORDER BY id ASC;
```

处理规则：

1. 不存在同 `domian`
   - 执行 INSERT。
   - 返回 `created`。

2. 存在同 `domian` 且 `tenant_id` 相同
   - 不 UPDATE，不 INSERT。
   - 返回 `unchanged` 或 `already_exists`，可视为流程可继续，但 UI 需提示“已存在，未重复写入”。

3. 存在同 `domian` 但 `tenant_id` 不同
   - 返回 `409 conflict`。
   - 不 INSERT，不 UPDATE。
   - 需要人工确认。

4. 存在多条同 `domian`
   - 返回 `409 conflict`。
   - 不 INSERT，不 UPDATE。
   - 需要人工清理/确认。

---

## 5. API 设计

### 5.1 Backend API

```http
POST /api/lines/tenant-domain/apply
```

请求：

```json
{
  "environmentId": "hashdev",
  "tenantId": 1,
  "domain": "l01-test.mgdevlab.com"
}
```

约束：

- `environmentId` 必须与 `X-Target-Environment` 一致。
- `domain` 必须来源于 Step2 confirmedSubdomain。
- MVP 可先只校验格式与前端传参，不做流程会话强绑定。

### 5.2 Agent API

```http
POST /v1/tenant-domain/apply
```

请求：

```json
{
  "tenantId": 1,
  "domain": "l01-test.mgdevlab.com"
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "action": "created",
    "tenantId": 1,
    "domain": "l01-test.mgdevlab.com",
    "status": 1,
    "id": 19
  }
}
```

已存在同租户响应：

```json
{
  "success": true,
  "data": {
    "action": "unchanged",
    "tenantId": 1,
    "domain": "l01-test.mgdevlab.com",
    "status": 1,
    "id": 19
  }
}
```

冲突响应：

```json
{
  "statusCode": 409,
  "message": "domain already exists for another tenant or duplicated records found",
  "conflicts": [
    { "id": 19, "tenantId": 2, "domain": "l01-test.mgdevlab.com", "status": 1 }
  ]
}
```

---

## 6. 前端 Step6 当前实现

保留现有人工 fallback：

- SQL 预览
- 复制 SQL
- 确认已手工执行 SQL

新增自动动作：

- 按钮：`自动写入 tenant_domain`
- 成功后展示：`created / unchanged`
- 冲突时展示错误信息，要求人工确认
- 自动写入成功或 unchanged 后，将 `sqlConfirmed = true`

按钮依赖（测试阶段已临时放开 Step5 前置）：

- 已选择租户：`selectedTenantId`
- 已确认步骤2子域名：`confirmedSubdomain`
- 当前不再强制依赖步骤5联通性检查：`connectivityChecked`

说明：测试阶段允许未完成 Step5 时验证 Step6 自动写入；生产流程是否恢复 Step5 前置限制后续再定。

---

## 7. 审计与日志

权限控制本阶段暂不做，留作后续优化重点。

MVP 先打日志：

Backend 记录：

- `requestId`
- `userId/username`（如可用）
- `environmentId`
- `tenantId`
- `domain`
- `action/result`

Agent 记录：

- `requestId`
- `environmentId`
- `tenantId`
- `domain`
- 查询到的冲突数量
- insert id 或 conflict 摘要

---

## 8. 测试状态

已验证通过：

1. 新 domain：可写入 `tenant.tenant_domain`。
2. 重复提交同 tenant/domain：返回 `unchanged`，前端提示“已存在，未重复写入”，不新增第二行。

待补充/后续回归：

3. domain 已属于其他 tenant：应返回 `409`，不写入。
4. domain 存在多条历史重复：应返回 `409`，不写入。
5. 非法 domain：应返回 `400`。
6. agent token 缺失/错误：应返回鉴权错误。
7. MySQL 连接失败：应返回可读错误，不误标记 Step6 完成。

---

## 9. 后续优化

1. 权限 key：例如 `line-onboarding:tenant-domain:write`。
2. 审计表持久化：记录每次写库尝试。
3. 数据库唯一索引评估：业务确认后可考虑为 `domian` 增加唯一约束，或至少建立检测/巡检任务。
4. 流程会话绑定：确保 Step6 domain 必须来自同一次 Step2 confirmedSubdomain。
5. 是否恢复 Step5 前置限制：当前测试阶段已放开 Step6 对 `connectivityChecked` 的依赖，生产流程需再决定是否恢复或改为配置开关。
6. 冲突详情展示增强：当前前端主要展示错误信息，后续可将 409 conflicts 表格化展示。

---

## 10. 下一步计划

结合当前新增线路流程，推荐下一步优先级：

1. **修复 Step5 超级后台登记 400 问题**
   - 已定位根因：`/admin/app/line/url/add` 需要 JSON，且 `AppLineUrl.version` 为必填。
   - 最小修复：register payload 增加 `version: '1'`（或业务确认后的版本值）。
   - 修复后重新测试“确认并自动登记新线路”。

2. **Step7 外部 API 验收回归**
   - 在 Step5/Step6 都完成后，调用外部 `/api/lines` 验证新线路是否可被外部系统发现。
   - 如失败，区分是超级后台登记未生效、tenant_domain 未同步、还是外部聚合服务延迟。

3. **端到端流程文档/证据沉淀**
   - 记录 Step4 ingress clone 成功证据。
   - 记录 Step6 `created/unchanged` 证据。
   - 记录 Step7 验收结果。

4. **审计与权限增强（后续）**
   - requestId/userId/username 全链路日志样例。
   - tenant_domain 写入权限控制。
   - 可选审计表。
