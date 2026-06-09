# Dashboard SiteConf 配置中心开发计划

> 日期：2026-06-09  
> 项目：`dashboard`  
> 目标：将 dashboard 项目自身的运行期配置、业务开关、非启动级参数统一纳入 `siteconf 配置` 菜单维护，降低 `.env` / 部署环境变量的长期维护成本。

## 1. 背景与问题

当前 dashboard 项目存在多处配置来源：

- `eks-dashboard-backend/.env`
- 部署环境变量
- 代码默认值
- 现有环境配置表，例如 `environments_config`
- 各功能模块内部直接读取 `process.env` 或 `ConfigService`

随着功能增加，`.env` 中配置项逐渐增多，存在以下问题：

1. 配置散落，维护成本高。
2. 修改配置通常依赖改文件、改部署环境或重启服务。
3. 新功能继续新增变量时缺少统一入口。
4. 运行期策略类参数和启动必需参数混在一起，不利于管理。

因此新增 dashboard 内部的 `siteconf 配置` 菜单，用于维护 dashboard 项目自身配置。

> 注意：这里的 siteconf 不是远程维护 EKS 集群业务系统的 `/admin/site/conf/list`，也不应该通过 Kubernetes proxy 访问业务系统配置。

## 2. 设计原则

### 2.1 配置分层

| 类型 | 存放位置 | 是否推荐迁到 dashboard siteconf | 示例 |
|---|---|---:|---|
| 启动必需配置 | `.env` / K8s Secret / Deployment env | 否 | `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` |
| 运行期策略参数 | `dashboard_site_conf` | 是 | timeout、TTL、limit、开关 |
| SSO 非密钥配置 | `dashboard_site_conf` + `.env` 兜底 | 是 | `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, redirect URI |
| 密钥/Token | 暂保留 `.env` / Secret，后续可加密迁移 | 谨慎 | `KEYCLOAK_CLIENT_SECRET`, `AIOPS_OPENCLAW_TOKEN` |
| 环境连接详情 | 现有环境配置体系 | 视情况 | K8s context、DB/Redis endpoint、租户配置 |

### 2.2 启动依赖边界

`dashboard_site_conf` 存在数据库里，因此 DB 连接本身不能依赖 siteconf，否则会出现启动循环依赖。

继续保留在 `.env`：

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_DATABASE`

### 2.3 读取优先级

后端统一通过 `SiteConfService` 读取配置：

```ts
await this.siteConf.getString('sso.keycloak.issuer', fallback)
await this.siteConf.getNumber('aiops.sql.timeout_ms', 5000)
await this.siteConf.getBoolean('query_center.gateway.enabled', false)
await this.siteConf.getJson('line.provider.rules_json', [])
```

读取顺序：

1. DB：`dashboard_site_conf.conf_value`
2. legacy `.env`：通过默认配置里的 `envKey` 映射兜底
3. 代码默认值：`defaultValue` 或调用方传入的 fallback

## 3. 当前已完成内容

提交：`a09516f feat: add dashboard siteconf management`

### 3.1 Phase 0：回退错误实现 —— 已完成

已回退错误方向：

- 不再通过 Kubernetes service proxy 访问业务系统。
- 不再访问业务接口 `/admin/site/conf/list`。
- 不再绑定 `kylin-admin-kylin-admin-impl`。
- 当前 siteconf 只管理 dashboard 项目自身配置。

### 3.2 Phase 1：DB 配置中心 MVP —— 已完成

新增数据库表：`dashboard_site_conf`

SQL 文件：

- `eks-dashboard-backend/scripts/sql/2026-06-09_dashboard_site_conf.sql`

表结构核心字段：

| 字段 | 用途 |
|---|---|
| `id` | 主键 |
| `conf_key` | 唯一配置 key |
| `conf_value` | 配置值 |
| `value_type` | `string` / `number` / `boolean` / `json` |
| `category` | 分类，例如 `sso`, `line`, `aiops` |
| `description` | 配置说明 |
| `is_sensitive` | 是否敏感 |
| `is_runtime_editable` | 是否运行期可编辑 |
| `default_value` | 默认值 |
| `validation_json` | 校验规则 JSON |
| `created_at` / `updated_at` | 时间戳 |

后端新增模块：

- `eks-dashboard-backend/src/site-conf/site-conf.module.ts`
- `eks-dashboard-backend/src/site-conf/site-conf.service.ts`
- `eks-dashboard-backend/src/site-conf/site-conf.controller.ts`
- `eks-dashboard-backend/src/site-conf/site-conf.defaults.ts`
- `eks-dashboard-backend/src/site-conf/dto/site-conf.dto.ts`

后端 API：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/site-conf` | 列表 / 搜索 / 分类过滤 |
| `GET` | `/api/site-conf/categories` | 分类列表 |
| `POST` | `/api/site-conf` | 新增或更新配置 |
| `DELETE` | `/api/site-conf/:confKey` | 删除配置 |

后端能力：

- 启动时自动 `CREATE TABLE IF NOT EXISTS`
- 启动时 seed 默认配置，不覆盖已有值
- 内存缓存，默认 TTL 30s
- 保存/删除后刷新缓存
- 类型校验：number / boolean / json
- `validation_json` 支持基础规则：`min` / `max` / `enum`
- typed getters：`getString` / `getNumber` / `getBoolean` / `getJson`

### 3.3 前端菜单 —— 已完成

新增页面：

- `eks-dashboard-frontend/src/pages/SiteConfPage.tsx`

菜单位置：

- 系统管理 → `siteconf 配置`

页面能力：

- 搜索 key / 说明
- 分类过滤
- 列表分页
- 新增配置
- 编辑配置
- 删除配置
- value type 选择：`string` / `number` / `boolean` / `json`
- 前端基础类型校验
- 敏感配置展示为 `********`

### 3.4 权限 —— 已完成 MVP

新增菜单权限：

- `menu:site-conf`

已加入：

- `eks-dashboard-backend/src/access-control/access-control.service.ts`
- `eks-dashboard-backend/scripts/init-admin.js`
- SQL migration 中也包含 permission 初始化

当前约定：

- MVP 阶段只考虑 admin / 菜单权限。
- 暂不拆分 `siteconf:read` / `siteconf:write`。
- 暂不做复杂脱敏审计权限拆分。

### 3.5 SSO / Keycloak 非密钥配置接入 —— 已完成

已改造 `eks-dashboard-backend/src/auth/auth.service.ts`，以下配置 siteconf 优先、`.env` 兜底：

| siteconf key | legacy env key |
|---|---|
| `sso.keycloak.issuer` | `KEYCLOAK_ISSUER` |
| `sso.keycloak.client_id` | `KEYCLOAK_CLIENT_ID` |
| `sso.keycloak.redirect_uri` | `KEYCLOAK_REDIRECT_URI` |
| `sso.keycloak.redirect_uris` | `KEYCLOAK_REDIRECT_URIS` |
| `sso.frontend.redirect_uri` | `SSO_FRONTEND_REDIRECT_URI` |
| `sso.frontend.redirect_uris` | `SSO_FRONTEND_REDIRECT_URIS` |

继续保留 `.env`：

- `KEYCLOAK_CLIENT_SECRET`

原因：第一版暂不把 secret 暴露到页面配置，降低误泄露和误覆盖风险。

### 3.6 构建验证 —— 已完成

已通过：

```bash
npm run build --prefix eks-dashboard-backend
npm run build --prefix eks-dashboard-frontend
```

前端仍有既有大 chunk warning，不影响构建。

## 4. 当前默认 seed 配置

当前默认清单在：

- `eks-dashboard-backend/src/site-conf/site-conf.defaults.ts`

已覆盖分类：

### 4.1 line

- `line.availability.window_ms`
- `line.availability.cache_ttl_ms`
- `line.availability.up_threshold`
- `line.provider.cache_ttl_ms`
- `line.provider.rules_json`
- `line.ssl.cache_ttl_ms`
- `line.ssl.tls_timeout_ms`
- `line.ssl.resolve_concurrency`

### 4.2 aiops

- `aiops.openclaw.timeout_ms`
- `aiops.nl2sql.fewshot_max_cases`
- `aiops.sql.default_limit`
- `aiops.sql.max_limit`
- `aiops.sql.timeout_ms`

### 4.3 query-center

- `query_center.gateway.enabled`
- `query_center.gateway.timeout_ms`
- `query_center.gateway.env_allowlist`
- `query_center.gateway.env_denylist`
- `query_center.gateway.transport`

### 4.4 sso

- `sso.keycloak.issuer`
- `sso.keycloak.client_id`
- `sso.keycloak.redirect_uri`
- `sso.keycloak.redirect_uris`
- `sso.frontend.redirect_uri`
- `sso.frontend.redirect_uris`

## 5. 尚未完成 / 后续开发计划

### 5.1 Phase 2：逐步接入更多业务模块 —— 部分完成

已完成：

- SSO / Keycloak 非密钥配置读取

待迁移：

#### line 模块

当前仍有部分代码直接读 legacy env / ConfigService。后续可逐步替换为：

```ts
await this.siteConf.getNumber('line.availability.window_ms', 120000)
await this.siteConf.getNumber('line.ssl.tls_timeout_ms', 5000)
await this.siteConf.getJson('line.provider.rules_json', [])
```

候选 legacy env：

- `LINE_AVAILABILITY_WINDOW_MS`
- `LINE_AVAILABILITY_CACHE_TTL_MS`
- `LINE_AVAILABILITY_HTTP_TIMEOUT_MS`
- `LINE_AVAILABILITY_UP_THRESHOLD`
- `LINE_PROVIDER_CACHE_TTL_MS`
- `LINE_PROVIDER_RULES_JSON`
- `LINE_SSL_CACHE_TTL_MS`
- `LINE_SSL_TLS_TIMEOUT_MS`
- `LINE_SSL_RESOLVE_CONCURRENCY`

注意：当前 seed 暂未包含 `LINE_AVAILABILITY_HTTP_TIMEOUT_MS`，后续迁移 line 模块时应补 key，例如：

- `line.availability.http_timeout_ms`

#### aiops 模块

候选 legacy env：

- `AIOPS_OPENCLAW_TIMEOUT_MS`
- `AIOPS_NL2SQL_FEWSHOT_MAX_CASES`
- `AIOPS_SQL_DEFAULT_LIMIT`
- `AIOPS_SQL_MAX_LIMIT`
- `AIOPS_SQL_TIMEOUT_MS`

暂不建议第一阶段迁移 secret：

- `AIOPS_OPENCLAW_TOKEN`
- `AIOPS_EVENT_INGEST_TOKEN`

#### query-center 模块

候选 legacy env：

- `QUERY_CENTER_GATEWAY_ENABLED`
- `QUERY_CENTER_GATEWAY_TIMEOUT_MS`
- `QUERY_CENTER_GATEWAY_ENV_ALLOWLIST`
- `QUERY_CENTER_GATEWAY_ENV_DENYLIST`
- `QUERY_CENTER_GATEWAY_TRANSPORT`

暂不建议第一阶段迁移 secret：

- `QUERY_CENTER_AGENT_TOKEN`

### 5.2 Phase 3：配置初始化脚本增强 —— 部分完成

已完成：

- 服务启动时自动建表和 seed 默认值。
- SQL migration 建表和初始化 `menu:site-conf`。

后续可增强：

1. 独立 seed 脚本：`scripts/init-site-conf.js`
2. 从 `.env-example` 自动识别 key 并生成候选配置。
3. 支持 dry-run：只展示将导入哪些 key，不写库。
4. 支持不覆盖已有 DB 配置。
5. 生成迁移报告，明确哪些 env 已迁、哪些保留。

### 5.3 Phase 4：审计与权限细分 —— 未完成

当前 MVP 暂不做。

后续建议新增权限：

- `siteconf:read`
- `siteconf:write`
- `siteconf:delete`
- `siteconf:sensitive:read`
- `siteconf:sensitive:write`

审计建议：

- 创建配置
- 修改配置
- 删除配置
- 修改敏感配置
- 修改 SSO 配置

审计内容注意：

- 敏感值不要记录明文。
- 可以记录 hash / 长度 / 是否变化。

### 5.4 密钥配置迁移 —— 未完成，需单独设计

可迁但需要加安全设计的 key：

- `KEYCLOAK_CLIENT_SECRET`
- `AIOPS_OPENCLAW_TOKEN`
- `AIOPS_EVENT_INGEST_TOKEN`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `QUERY_CENTER_AGENT_TOKEN`
- webhook URL

推荐方案：

1. 不直接明文展示。
2. 页面只允许“覆盖写入”，不回显原文。
3. DB 层加密或引用外部 Secret。
4. 审计日志不记录明文。
5. 多人权限细分后再开放。

### 5.5 多副本缓存一致性 —— 未完成

当前实现：

- 单实例内存缓存
- TTL 默认 30s
- 当前实例保存/删除后刷新当前实例缓存

多副本风险：

- A 实例修改配置后，B 实例最多延迟 TTL 时间看到变化。

后续优化选项：

1. 保持 TTL，接受 30s 内最终一致。
2. 增加 `site_conf_version` 表，读取时检查版本。
3. 使用 Redis pub/sub 广播刷新。
4. 后续如果 dashboard 已有统一事件总线，可复用。

### 5.6 删除策略 —— MVP 已做硬删除，后续可改软删除

当前：

- `DELETE /api/site-conf/:confKey` 直接删除。

后续建议：

- 增加 `deleted_at` 字段。
- 默认列表不显示已删除。
- 支持恢复。
- 删除纳入审计。

### 5.7 前端体验增强 —— 未完成

可优化项：

1. JSON value 格式化按钮。
2. 根据 `validation_json` 自动渲染 enum 下拉。
3. 根据 `value_type=boolean` 渲染 switch。
4. 编辑敏感配置时只允许覆盖，不自动回显明文。
5. 展示 legacy env 来源 / DB 来源 / default 来源。
6. 展示“修改后是否需要重启”。

## 6. SSO 是否能迁到 siteconf？

结论：可以迁移非密钥项，当前已经完成。

### 已迁移读取

- `KEYCLOAK_ISSUER`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_REDIRECT_URI`
- `KEYCLOAK_REDIRECT_URIS`
- `SSO_FRONTEND_REDIRECT_URI`
- `SSO_FRONTEND_REDIRECT_URIS`

### 暂不迁移

- `KEYCLOAK_CLIENT_SECRET`

原因：

- 属于 secret。
- 第一版 siteconf 暂未做密钥加密、只写不读、审计脱敏、权限细分。
- 继续放 `.env` / Secret 更稳。

## 7. 部署注意事项

### 7.1 数据库

服务启动会自动建表，但建议部署前执行 SQL：

```bash
mysql < eks-dashboard-backend/scripts/sql/2026-06-09_dashboard_site_conf.sql
```

或确认服务启动用户有建表权限。

### 7.2 权限

如果 admin 看不到菜单，检查：

1. `permissions` 表是否存在 `menu:site-conf`
2. admin 所在 role 是否关联该 permission
3. 是否执行过 `scripts/init-admin.js`

### 7.3 `.env` 保留

必须保留：

- `DB_*`
- `KEYCLOAK_CLIENT_SECRET`

建议暂时保留所有 legacy env，直到对应业务模块完成 siteconf 读取迁移并验证稳定。

## 8. 推荐后续顺序

### 优先级 P0

1. 部署前确认 `dashboard_site_conf` 表创建成功。
2. 确认 admin 能看到 `系统管理 → siteconf 配置`。
3. 验证 SSO 配置从 siteconf 修改后是否生效。

### 优先级 P1

1. 接入 line 模块运行期配置读取。
2. 接入 query-center gateway 配置读取。
3. 接入 aiops timeout / limit 配置读取。

### 优先级 P2

1. 增加操作审计。
2. 增加权限细分。
3. 增加敏感配置只写不读机制。
4. 多副本缓存刷新机制。

### 优先级 P3

1. `.env-example` 自动导入脚本。
2. 前端 JSON 格式化 / enum 渲染。
3. soft delete / restore。

## 9. 当前完成度总结

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 回退错误实现 | 已完成 | 已移除 EKS 业务 siteconf 方向 |
| Phase 1 DB 配置中心 MVP | 已完成 | 表、后端、前端、权限、默认 seed 均已实现 |
| Phase 2 接入读取服务 | 部分完成 | SSO 非密钥已接入，其它模块待迁移 |
| Phase 3 初始化/迁移 | 部分完成 | 启动 seed + SQL 已有，独立导入脚本未做 |
| Phase 4 审计与权限细分 | 未完成 | 当前按 admin 菜单权限控制 |
| 密钥配置迁移 | 未完成 | 需单独设计安全方案 |
| 多副本缓存一致性 | 未完成 | 当前 TTL 最终一致 |
