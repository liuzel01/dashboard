# Dashboard 用户操作审计日志 MVP 开发计划

> 状态：计划文档，仅用于对齐实现步骤；尚未开始代码实现。  
> 范围：追踪用户在 Dashboard 内触发的后端 API 操作历史；不记录页面访问/菜单点击；暂不做提交/审核流；暂不做操作前后 diff。

## 0. 结论与边界

### 推荐实现

- 后端 API 审计为主。
- 新增审计日志表 `audit_logs`。
- 新增审计日志查询页面，挂在“账号管理”父级菜单下：
  - `账号与权限`
  - `审计日志`
- 审计日志页面沿用已有权限：`menu:access-control`。
- 暂不新增单独菜单权限。
- 审计写入失败不能影响原业务接口。
- 默认保留周期按 90 天设计；第一版不加自动定时清理，只提供手动清理 90 天前日志的按钮/接口。

### 明确不做

- 不记录页面访问/菜单点击。
- 不记录“用户看过哪些页面”。
- 不做审批/审核工作流。
- 不记录操作前后 diff。
- 不引入独立审计日志权限，先共用 `menu:access-control`。

---

## 1. 人工前置准备：数据库变更

> 这部分建议先由人工执行并确认。后续代码实现依赖 `audit_logs` 表具备新审计页面所需字段。

### 1.1 仓库现状确认

仓库内已经存在一张早期规划/访问控制相关的通用审计表：

```text
eks-dashboard-backend/scripts/sql/2026-03-11_access_control.sql
```

当前建表语句为：

```sql
CREATE TABLE `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `actor_user_id` bigint(20) unsigned DEFAULT NULL,
  `action` varchar(128) NOT NULL,
  `target_type` varchar(64) DEFAULT NULL,
  `target_id` varchar(64) DEFAULT NULL,
  `meta` json DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_user_id`),
  KEY `idx_audit_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

同时，AI 运维实际使用的是独立 SQL 审计表，不是这张 `audit_logs`：

```text
eks-dashboard-backend/scripts/sql/2026-04-08_ai_ops.sql
  - aiops_sessions
  - aiops_actions
  - aiops_sql_audit
  - aiops_ingest_events
```

结论：

- 不应再直接执行 `CREATE TABLE IF NOT EXISTS audit_logs (...)` 创建新结构。
- 如果目标库已经存在旧版 `audit_logs`，`CREATE TABLE IF NOT EXISTS` 不会补字段，会导致后续代码缺字段。
- 第一版应复用并扩展现有 `audit_logs` 表，避免同名表冲突。

### 1.2 人工确认：当前库是否已有 `audit_logs`

先执行：

```sql
SHOW CREATE TABLE audit_logs;
SHOW INDEX FROM audit_logs;
```

如果表不存在，再按“1.4 新库完整建表 SQL”执行。

如果表已存在且结构类似 `2026-03-11_access_control.sql`，按“1.3 旧表扩展 ALTER SQL”执行。

### 1.3 旧表扩展 ALTER SQL（推荐路径）

建议新增 SQL 文件：

```text
eks-dashboard-backend/scripts/sql/2026-05-12_extend_audit_logs.sql
```

> 注意：以下 SQL 按 MySQL 5.7 兼容风格书写，使用 `information_schema` + prepared statement 避免 `ADD COLUMN IF NOT EXISTS` 兼容性问题。

```sql
SET @db_name = DATABASE();

-- target_id 原 varchar(64) 对 S3 bucket/key、路径类资源可能过短，扩展到 512。
SET @target_id_len = (
  SELECT CHARACTER_MAXIMUM_LENGTH
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'audit_logs'
    AND COLUMN_NAME = 'target_id'
);
SET @ddl_target_id = IF(
  @target_id_len IS NOT NULL AND @target_id_len < 512,
  'ALTER TABLE `audit_logs` MODIFY COLUMN `target_id` varchar(512) DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt_target_id FROM @ddl_target_id;
EXECUTE stmt_target_id;
DEALLOCATE PREPARE stmt_target_id;

-- actor/display 信息
SET @has_actor_username = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'actor_username');
SET @ddl_actor_username = IF(@has_actor_username = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `actor_username` varchar(128) DEFAULT NULL AFTER `actor_user_id`', 'SELECT 1');
PREPARE stmt_actor_username FROM @ddl_actor_username; EXECUTE stmt_actor_username; DEALLOCATE PREPARE stmt_actor_username;

SET @has_actor_display_name = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'actor_display_name');
SET @ddl_actor_display_name = IF(@has_actor_display_name = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `actor_display_name` varchar(128) DEFAULT NULL AFTER `actor_username`', 'SELECT 1');
PREPARE stmt_actor_display_name FROM @ddl_actor_display_name; EXECUTE stmt_actor_display_name; DEALLOCATE PREPARE stmt_actor_display_name;

-- 环境/API 来源
SET @has_environment_id = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'environment_id');
SET @ddl_environment_id = IF(@has_environment_id = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `environment_id` varchar(64) DEFAULT NULL AFTER `actor_display_name`', 'SELECT 1');
PREPARE stmt_environment_id FROM @ddl_environment_id; EXECUTE stmt_environment_id; DEALLOCATE PREPARE stmt_environment_id;

SET @has_method = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'method');
SET @ddl_method = IF(@has_method = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `method` varchar(16) DEFAULT NULL AFTER `environment_id`', 'SELECT 1');
PREPARE stmt_method FROM @ddl_method; EXECUTE stmt_method; DEALLOCATE PREPARE stmt_method;

SET @has_path = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'path');
SET @ddl_path = IF(@has_path = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `path` varchar(512) DEFAULT NULL AFTER `method`', 'SELECT 1');
PREPARE stmt_path FROM @ddl_path; EXECUTE stmt_path; DEALLOCATE PREPARE stmt_path;

SET @has_menu_key = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'menu_key');
SET @ddl_menu_key = IF(@has_menu_key = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `menu_key` varchar(128) DEFAULT NULL AFTER `path`', 'SELECT 1');
PREPARE stmt_menu_key FROM @ddl_menu_key; EXECUTE stmt_menu_key; DEALLOCATE PREPARE stmt_menu_key;

-- 操作展示名
SET @has_action_name = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action_name');
SET @ddl_action_name = IF(@has_action_name = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `action_name` varchar(255) DEFAULT NULL AFTER `action`', 'SELECT 1');
PREPARE stmt_action_name FROM @ddl_action_name; EXECUTE stmt_action_name; DEALLOCATE PREPARE stmt_action_name;

-- 摘要；保留旧 meta 字段用于兼容，也新增 request/response summary。
SET @has_request_summary = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'request_summary');
SET @ddl_request_summary = IF(@has_request_summary = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `request_summary` json DEFAULT NULL AFTER `meta`', 'SELECT 1');
PREPARE stmt_request_summary FROM @ddl_request_summary; EXECUTE stmt_request_summary; DEALLOCATE PREPARE stmt_request_summary;

SET @has_response_summary = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'response_summary');
SET @ddl_response_summary = IF(@has_response_summary = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `response_summary` json DEFAULT NULL AFTER `request_summary`', 'SELECT 1');
PREPARE stmt_response_summary FROM @ddl_response_summary; EXECUTE stmt_response_summary; DEALLOCATE PREPARE stmt_response_summary;

-- 结果/排查信息
SET @has_status = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'status');
SET @ddl_status = IF(@has_status = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `status` varchar(32) DEFAULT NULL AFTER `response_summary`', 'SELECT 1');
PREPARE stmt_status FROM @ddl_status; EXECUTE stmt_status; DEALLOCATE PREPARE stmt_status;

SET @has_status_code = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'status_code');
SET @ddl_status_code = IF(@has_status_code = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `status_code` int DEFAULT NULL AFTER `status`', 'SELECT 1');
PREPARE stmt_status_code FROM @ddl_status_code; EXECUTE stmt_status_code; DEALLOCATE PREPARE stmt_status_code;

SET @has_error_message = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'error_message');
SET @ddl_error_message = IF(@has_error_message = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `error_message` text DEFAULT NULL AFTER `status_code`', 'SELECT 1');
PREPARE stmt_error_message FROM @ddl_error_message; EXECUTE stmt_error_message; DEALLOCATE PREPARE stmt_error_message;

SET @has_duration_ms = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'duration_ms');
SET @ddl_duration_ms = IF(@has_duration_ms = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `duration_ms` int DEFAULT NULL AFTER `error_message`', 'SELECT 1');
PREPARE stmt_duration_ms FROM @ddl_duration_ms; EXECUTE stmt_duration_ms; DEALLOCATE PREPARE stmt_duration_ms;

SET @has_ip = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'ip');
SET @ddl_ip = IF(@has_ip = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `ip` varchar(64) DEFAULT NULL AFTER `duration_ms`', 'SELECT 1');
PREPARE stmt_ip FROM @ddl_ip; EXECUTE stmt_ip; DEALLOCATE PREPARE stmt_ip;

SET @has_user_agent = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'user_agent');
SET @ddl_user_agent = IF(@has_user_agent = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `user_agent` varchar(512) DEFAULT NULL AFTER `ip`', 'SELECT 1');
PREPARE stmt_user_agent FROM @ddl_user_agent; EXECUTE stmt_user_agent; DEALLOCATE PREPARE stmt_user_agent;

SET @has_trace_id = (SELECT COUNT(1) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'trace_id');
SET @ddl_trace_id = IF(@has_trace_id = 0, 'ALTER TABLE `audit_logs` ADD COLUMN `trace_id` varchar(128) DEFAULT NULL AFTER `user_agent`', 'SELECT 1');
PREPARE stmt_trace_id FROM @ddl_trace_id; EXECUTE stmt_trace_id; DEALLOCATE PREPARE stmt_trace_id;

-- 索引。MySQL 5.7 无 CREATE INDEX IF NOT EXISTS，使用 information_schema 判断。
SET @has_idx_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_created');
SET @ddl_idx_created = IF(@has_idx_created = 0, 'CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`)', 'SELECT 1');
PREPARE stmt_idx_created FROM @ddl_idx_created; EXECUTE stmt_idx_created; DEALLOCATE PREPARE stmt_idx_created;

SET @has_idx_status_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_status_created');
SET @ddl_idx_status_created = IF(@has_idx_status_created = 0, 'CREATE INDEX `idx_audit_status_created` ON `audit_logs` (`status`, `created_at`)', 'SELECT 1');
PREPARE stmt_idx_status_created FROM @ddl_idx_status_created; EXECUTE stmt_idx_status_created; DEALLOCATE PREPARE stmt_idx_status_created;

SET @has_idx_method_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_method_created');
SET @ddl_idx_method_created = IF(@has_idx_method_created = 0, 'CREATE INDEX `idx_audit_method_created` ON `audit_logs` (`method`, `created_at`)', 'SELECT 1');
PREPARE stmt_idx_method_created FROM @ddl_idx_method_created; EXECUTE stmt_idx_method_created; DEALLOCATE PREPARE stmt_idx_method_created;

SET @has_idx_env_created = (SELECT COUNT(1) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_env_created');
SET @ddl_idx_env_created = IF(@has_idx_env_created = 0, 'CREATE INDEX `idx_audit_env_created` ON `audit_logs` (`environment_id`, `created_at`)', 'SELECT 1');
PREPARE stmt_idx_env_created FROM @ddl_idx_env_created; EXECUTE stmt_idx_env_created; DEALLOCATE PREPARE stmt_idx_env_created;
```

### 1.4 新库完整建表 SQL（仅当目标库不存在 `audit_logs` 时使用）

如果目标库没有 `audit_logs`，可以使用包含旧字段和新字段的完整建表 SQL，避免未来与 `2026-03-11_access_control.sql` 语义割裂：

```sql
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `actor_user_id` bigint(20) unsigned DEFAULT NULL,
  `actor_username` varchar(128) DEFAULT NULL,
  `actor_display_name` varchar(128) DEFAULT NULL,
  `environment_id` varchar(64) DEFAULT NULL,
  `method` varchar(16) DEFAULT NULL,
  `path` varchar(512) DEFAULT NULL,
  `menu_key` varchar(128) DEFAULT NULL,
  `action` varchar(128) NOT NULL,
  `action_name` varchar(255) DEFAULT NULL,
  `target_type` varchar(64) DEFAULT NULL,
  `target_id` varchar(512) DEFAULT NULL,
  `meta` json DEFAULT NULL,
  `request_summary` json DEFAULT NULL,
  `response_summary` json DEFAULT NULL,
  `status` varchar(32) DEFAULT NULL,
  `status_code` int DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `trace_id` varchar(128) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_user_id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_status_created` (`status`, `created_at`),
  KEY `idx_audit_method_created` (`method`, `created_at`),
  KEY `idx_audit_env_created` (`environment_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 1.5 是否修改其他现有表

第一版不需要修改其他表。

- 不修改 `users`。
- 不修改 `roles`。
- 不修改 `permissions`。
- 不修改 AI 运维的 `aiops_sql_audit`。
- 不新增 `menu:audit-logs` 权限。

### 1.6 人工执行后的验证 SQL

```sql
SHOW CREATE TABLE audit_logs;
SHOW INDEX FROM audit_logs;
```

可选插入/删除测试：

```sql
INSERT INTO audit_logs (
  actor_username, method, path, action, action_name, status, status_code, request_summary, created_at
) VALUES (
  'manual-test', 'POST', '/manual/test', 'manual.test', '人工测试', 'success', 200, JSON_OBJECT('ok', true), NOW()
);

SELECT id, created_at, actor_username, method, path, action_name, status
FROM audit_logs
ORDER BY id DESC
LIMIT 5;

DELETE FROM audit_logs WHERE actor_username = 'manual-test';
```

---

## 2. 审计记录范围

### 2.1 必须记录

- 登录成功。
- 登录失败。
- 登出。
- 查询类操作中“按钮/功能触发型”的 GET。
- 写操作：`POST` / `PUT` / `PATCH`。
- 删除/重启类操作：`DELETE`，以及用于重启/执行动作的 `POST`。
- 权限配置变更，尤其：
  - 创建用户。
  - 修改用户。
  - 创建角色。
  - 修改角色。
  - 删除角色。
  - 修改角色权限。

### 2.2 不记录

- 页面访问。
- 菜单点击。
- 常规页面刷新/初始化接口。
- 高频、低价值的轮询接口。

### 2.3 GET 记录规则

用户确认：GET 不做全量记录，只记录“按钮类/功能类触发操作”。

建议第一版使用白名单方式，而不是黑名单方式。

示例白名单：

```ts
const AUDIT_GET_RULES = [
  // S3 上传页里由用户选择/查询触发，是否记录可按实际噪音再调整。
  { path: '/s3/buckets', action: 's3.listBuckets', actionName: '查询 S3 Bucket' },
  { path: '/s3/prefixes', action: 's3.listPrefixes', actionName: '查询 S3 路径' },

  // 数据查询类、AI 运维类、高风险信息查询类后续按现有 API path 补齐。
];
```

注意：不要把所有页面初始化 GET 都纳入白名单，例如 `/auth/me`、审计日志页面自身查询接口等。

---

## 3. 脱敏要求

### 3.1 原则

- 不保存明文密钥。
- 不保存上传文件内容。
- 不保存完整大响应体。
- 不保存完整大 SQL/AI 原始上下文，除非后续明确需要并做额外脱敏。
- 只保存“足够定位操作”的摘要。

### 3.2 字段名命中脱敏

字段名包含以下关键词时替换为 `***`：
（最终展示的字段能不能是ha**ex，保留两边的字符同时隐藏中间部分的）

```text
password
passwd
secret
token
authorization
credential
access_key
secret_key
aws_access_key_id
aws_secret_access_key
private_key
kubeconfig
cookie
```

### 3.3 上传文件摘要

S3 上传等文件接口只记录：

```json
{
  "bucket": "xxx",
  "key": "json/a.json",
  "filename": "a.json",
  "mimetype": "application/json",
  "size": 1234
}
```

不记录文件内容。

---

## 4. 后端实现计划

### 4.1 新增模块

建议新增目录：

```text
eks-dashboard-backend/src/audit/
  audit.module.ts
  audit.service.ts
  audit.controller.ts
  audit.interceptor.ts
  audit.mapper.ts
  audit.sanitizer.ts
```

### 4.2 `AuditService`

职责：

- 写入审计日志。
- 查询审计日志。
- 手动清理 90 天前日志。

关键要求：

- `record()` 内部必须 catch error。
- 审计写入失败只打日志，不抛给业务接口。

伪代码：

```ts
async record(input: AuditLogInput) {
  try {
    await this.db.query('INSERT INTO audit_logs ...', params);
  } catch (err) {
    this.logger.warn(`Failed to write audit log: ${err.message}`);
  }
}
```

### 4.3 `AuditInterceptor`

职责：

- 拦截 API 请求。
- 判断是否需要审计。
- 记录开始时间。
- 成功时写 `status=success`。
- 失败时写 `status=failed`。
- 记录 `duration_ms`。

关键要求：

- 失败接口也要记录。
- 登录失败要记录。
- 审计写失败不能影响业务接口。

### 4.4 审计规则 mapper

新增 `audit.mapper.ts`，把 API 映射为可读操作。

示例：

```ts
PUT /roles/:id/permissions -> 修改角色权限
POST /s3/upload            -> 上传 S3 对象
POST /auth/login           -> 登录
```

未匹配到的接口：

- 对 `POST/PUT/PATCH/DELETE` 可 fallback 记录为：`METHOD path`。
- 对 `GET` 不 fallback，除非在 GET 白名单内。

### 4.5 权限配置变更记录要求

针对：

```text
PUT /roles/:id/permissions
```

必须记录清楚：

```json
{
  "roleId": 123,
  "permissionIds": [1, 2, 3]
}
```

不需要记录 before/after diff。

### 4.6 登录失败记录

登录失败时通常拿不到 `user_id`，但要记录：

```json
{
  "username": "input username",
  "status": "failed",
  "error_message": "...",
  "ip": "...",
  "user_agent": "..."
}
```

### 4.7 查询与清理接口

新增：

```http
GET /audit-logs
POST /audit-logs/cleanup
```

`GET /audit-logs` 参数：

```text
page
pageSize
startTime
endTime
username
method
status
environmentId
action
keyword
```

返回：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

`POST /audit-logs/cleanup`：

- 删除 90 天前日志。
- 返回删除数量。

```json
{
  "ok": true,
  "deleted": 123
}
```

---

## 5. 前端实现计划

### 5.1 菜单结构

把当前单菜单：

```text
账号管理
```

调整为父子菜单：

```text
账号管理
  - 账号与权限
  - 审计日志
```

路由建议：

```text
/access-control/users
/access-control/audit-logs
```

兼容旧路径：

```text
/access-control -> /access-control/users
```

权限：

```text
menu:access-control
```

两个子页面都沿用这个权限。

### 5.2 新增页面

新增：

```text
eks-dashboard-frontend/src/pages/AuditLogPage.tsx
```

页面能力：

- 筛选：
  - 时间范围。
  - 用户名。
  - 方法。
  - 状态。
  - 环境。
  - action。
  - 关键词。
- 表格：
  - 时间。
  - 用户。
  - 环境。
  - 方法。
  - 操作。
  - 资源。
  - 状态。
  - 耗时。
  - IP。
  - 详情。
- 详情弹窗：
  - path。
  - request summary。
  - response summary。
  - error message。
  - user agent。
  - trace id。

### 5.3 手动清理按钮

在审计日志页面增加按钮：

```text
清理 90 天前日志
```

点击后调用：

```http
POST /audit-logs/cleanup
```

需要二次确认弹窗。

---

## 6. 验收标准

### 6.1 登录失败

- 输入错误账号/密码。
- 登录接口返回失败。
- `audit_logs` 中出现失败记录。
- 记录 username/ip/user_agent/error_message。

### 6.2 审计写入不影响业务

- 人为让审计表不可写或模拟 `AuditService.record()` 抛错。
- 原业务接口仍按自身结果成功/失败返回。
- 后端日志出现审计写入失败 warning。

### 6.3 GET 记录策略

- 页面普通刷新/初始化不大量产生审计日志。
- 白名单内的按钮/功能型 GET 会产生审计日志。

### 6.4 权限配置变更

- 修改某角色权限。
- `audit_logs` 中出现记录：
  - 操作人。
  - `PUT /roles/:id/permissions`。
  - roleId。
  - permissionIds。
  - success/failed。

### 6.5 页面权限

- 拥有 `menu:access-control` 的用户能看到：
  - 账号与权限。
  - 审计日志。
- 没有 `menu:access-control` 的用户不能进入账号管理子菜单。

---

## 7. 建议开发顺序

1. 人工执行 `audit_logs` 建表 SQL，并确认索引。
2. 新增后端 Audit module/service/controller。
3. 新增 sanitizer 脱敏工具。
4. 新增 mapper 和审计规则。
5. 接入 interceptor，先覆盖：
   - 登录成功/失败。
   - POST/PUT/PATCH/DELETE。
   - GET 白名单。
6. 实现查询接口 `GET /audit-logs`。
7. 实现手动清理接口 `POST /audit-logs/cleanup`。
8. 前端新增审计日志 API。
9. 调整账号管理菜单为父子菜单。
10. 新增 AuditLogPage。
11. 前后端 build。
12. 按验收标准手动验证。
13. commit。

---

## 8. 需要再次确认的问题

开始编码前建议再确认：

1. GET 白名单第一版具体包含哪些接口？
- 包括： api/deployments，api/s3，api/environments
2. 审计日志页面是否允许导出 CSV？第一版建议不做。
- 先不用
3. `request_summary` / `response_summary` 最大长度是否需要硬限制？建议做，避免异常大对象写入。
- 做
4. 手动清理是否直接删除，还是先只做 dry-run？建议直接删除 90 天前记录，带二次确认。
- 嗯，点击按钮后二次确认，确认后删除90天以前的。