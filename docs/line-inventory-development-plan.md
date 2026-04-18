# 线路资产总览功能开发计划（草案）

本文档用于规划“线路资产总览”能力的落地，目标是在当前环境下，支持按租户查看线路基础信息、证书有效期、CDN 厂商归属和可用性状态。

## 1. 背景与目标

当前系统已有能力：

- 新增线路向导（`/line-onboarding`）可完成线路创建流程。
- “查看当前租户全部线路”可展示租户下线路基础信息（名称、地址、开关状态）。
- DCDN 状态接口可查询单域名证书到期等信息。
- 站点监控模块具备 DNS/TCP/HTTP/SSL 探测能力。

当前缺口：

- 缺少一个“线路资产总览”入口，统一展示全量线路与健康状态。
- 缺少对 CDN 厂商（AWS Global / Aliyun DCDN / Aliyun ESA）的统一识别字段。
- 缺少针对线路列表的批量可用性与证书状态聚合视图。

本期目标（MVP）：

- 提供独立线路总览页面（建议启用 `/lines`）。
- 提供聚合接口返回：线路基础信息 + SSL 到期 + CDN Provider + 可用性。
- 支持筛选、分页、手动刷新。
- 明确页面边界：`/lines` 仅展示“可用性摘要”，不承载线路延迟明细分析。

## 2. 范围定义

### 2.1 In Scope

- 当前环境下线路资产列表查询。
- 支持单租户与全部租户视角。
- 线路字段：`tenantId`、`zh`、`en`、`lineUrl`、`status`。
- 健康字段：`provider`、`sslExpireAt`、`sslDaysLeft`、`availability`、`lastCheckedAt`、`error`。
- 查询刷新与强制刷新（绕过缓存）。

### 2.2 Out of Scope（本期不做）

- 历史趋势图、长期报表。
- 自动修复、自动告警编排。
- 复杂多源校验与跨环境对比。
- 全量离线批任务平台化（可作为后续优化项）。
- 在本页面展示 `/api/latest` 原始探测明细（region、latency、http_status、error 明细列表）。

## 3. 方案概览

推荐采用“聚合接口 + 轻缓存 + 前端总览页”的方案：

1. 线路基础数据来自现有 `super-admin list`。
2. 证书信息优先通过 DCDN 状态接口补充。
3. 可用性检查复用站点探测逻辑（DNS/TCP/HTTP/SSL）。
4. Provider 通过“接口命中 + CNAME/域名规则”识别。
5. 对聚合结果进行短时缓存，避免页面阻塞。

补充约束（产品边界）：

- `/lines` 页面只展示“线路是否可用（up/down/unknown）+ 最后检查时间 + 简要原因码”。
- 不直接透出探测系统的原始明细数据结构，避免本项目演变为探测分析平台。
- 线路延迟、地域探测明细、失败详情追踪由探测项目页面承载（如 `probe-dash`）。

## 4. 后端任务清单

### 4.1 新增接口

- 新增：`GET /api/lines/inventory`
- 推荐参数：
  - `page`、`size`
  - `tenantId`（可选，不传表示全部租户）
  - `lineUrl`（可选，模糊匹配）
  - `provider`（可选：`aliyun_dcdn | aws_global | aliyun_esa | unknown`）
  - `availability`（可选：`up | down | unknown`）
  - `certExpireDaysLt`（可选，证书剩余天数阈值）
  - `refresh`（可选，`true` 时强制刷新）
- 筛选口径要求：
  - `status/provider/availability/certExpireDaysLt` 必须作用于“全量查询结果”，不应仅在当前页做后置过滤。

### 4.2 聚合流程

1. 查询线路基础列表（复用 `listSuperAdminLines`）。
2. 并发补充每条线路健康信息（受并发阈值控制）。
3. 计算并返回统一字段结构。

### 4.3 Provider 识别（首版规则）

- 规则 1：可通过 DCDN 接口稳定获取域名状态 => `aliyun_dcdn`
- 规则 2：CNAME/域名特征匹配 AWS Global => `aws_global`
- 规则 3：CNAME/域名特征匹配 Aliyun ESA => `aliyun_esa`
- 规则 4：无法识别 => `unknown`

备注：首版允许一定比例 `unknown`，后续可通过规则迭代降低。

### 4.4 可用性检测

- 优先复用站点监控已有探测方法（DNS/TCP/HTTP/SSL）。
- 也可选接入外部探测聚合服务（参考 `probe-dash` 的 `GET /api/probes/latest` / `GET /api/latest`）。
- 返回标准化状态：
  - `up`：探测成功，状态码命中可接受范围
  - `down`：探测失败或状态码异常
  - `unknown`：未探测/超时/依赖失败
- 无论使用本地探测还是外部探测，`/lines/inventory` 只输出汇总结果，不回传原始探测数组。

建议归一规则（若接入 `probe-dash`）：

- 聚合键：`line_url`（必要时结合 `region` 做内部判定，但不对前端暴露）。
- `up`：在有效时间窗内存在 `ok=true` 的记录。
- `down`：在有效时间窗内存在记录且均失败，或最新记录失败。
- `unknown`：超出有效时间窗无数据，或探测源不可达。
- `lastCheckedAt`：取该线路最近一条探测时间。

#### 4.4.1 可用性有效时间窗（统一定义）

- 默认有效时间窗：`2 分钟`（可配置，建议配置项：`LINE_AVAILABILITY_WINDOW_MS`）。
- 仅当 `now - lastCheckedAt <= 有效时间窗` 时，探测结果可用于判定 `up/down`。
- 当最新探测时间超出有效时间窗时，统一降级为 `unknown`，`error` 置为 `stale_data`。
- 若探测源不可达（接口错误/超时）且无可用缓存，同样返回 `unknown`。
- 默认可用阈值：`0.8`（可配置，配置项：`LINE_AVAILABILITY_UP_THRESHOLD`，支持 `0~1` 或 `1~100` 写法，例如 `0.8` 或 `80`）。

#### 4.4.2 `availability` 与 `error` 枚举规范（建议）

- `availability`：
  - `up`：有效时间窗内存在成功结果（或最新结果成功）。
  - `down`：有效时间窗内有探测结果但判定失败（或最新结果失败）。
  - `unknown`：无数据、数据过期、探测源异常、结果不可判定。
- `error`（摘要码，仅单值）：
  - `none`：无异常（通常对应 `up`）。
  - `timeout`：探测或聚合请求超时。
  - `http_4xx`：HTTP 客户端错误。
  - `http_5xx`：HTTP 服务端错误。
  - `dns_error`：DNS 解析失败。
  - `tcp_error`：TCP 连通失败。
  - `ssl_error`：SSL 证书或握手失败。
  - `probe_unreachable`：探测服务不可达。
  - `stale_data`：探测数据超出有效时间窗。
  - `no_data`：无可用探测记录。
  - `unknown_error`：未归类异常。

实现约束：

- `/lines/inventory` 仅返回上述摘要枚举，不返回原始错误堆栈/明细数组。
- 后端内部可保留 `errorMessage` 用于日志诊断，但默认不对前端透出。

#### 4.4.3 区域样本（成/败/未知）统计口径

`区域样本(成/败/未知)` 对应接口字段：

- `successRegions/failedRegions/unknownRegions/totalRegions`

统计规则：

- 先按 `host + region` 聚合探测记录，同一 `host+region` 仅保留最新一条样本。
- 仅统计“有效时间窗内”的样本（默认 `LINE_AVAILABILITY_WINDOW_MS=120000` 毫秒）。
- 样本状态判定：
  - `success`：`ok === true`
  - `failed`：`ok === false`
  - `unknown`：`ok` 不是 `true/false`（例如 `null`、缺失）
- `totalRegions = successRegions + failedRegions + unknownRegions`（针对有效窗口内样本）。

边界情况：

- 无任何探测记录：`0/0/0`，前端展示为 `-`。
- 有历史记录但都超出有效时间窗：`0/0/N`（`N` 为该线路历史 region 样本数），并返回 `availability=unknown`、`error=stale_data`。
- 若有效窗口内仅有 `unknown` 样本（`success+failed=0`），返回 `availability=unknown`、`error=no_data`。

### 4.5 性能与稳定性

- 并发限制：建议 10（可配置）。
- 单条探测超时：建议 3~5 秒（可配置）。
- 全链路超时：建议 15~30 秒。
- 短缓存：建议 1~5 分钟；`refresh=true` 直连刷新。
- 部分失败容忍：单条失败不影响整体返回。

### 4.6 可观测性

- 接口耗时、探测成功率、provider 命中率、错误分布。
- 关键日志字段：environmentId、tenantId、lineUrl、provider、availability、errorCode。

### 4.7 环境变量配置（MVP）

建议至少补齐以下变量：

- `LINE_INVENTORY_PROBE_API_URL`：线路探测聚合接口地址（推荐显式配置）。未配置时会尝试从 `LINE_VERIFY_API_URL` 推导。
- `LINE_AVAILABILITY_WINDOW_MS`：可用性有效时间窗（毫秒），默认 `120000`。
- `LINE_AVAILABILITY_CACHE_TTL_MS`：探测快照缓存 TTL（毫秒），默认 `15000`。
- `LINE_AVAILABILITY_HTTP_TIMEOUT_MS`：调用探测接口超时（毫秒），默认 `3000`。
- `LINE_AVAILABILITY_UP_THRESHOLD`：可用判定阈值，默认 `0.8`。支持 `0~1` 或百分比（如 `80`）。
- `LINE_PROVIDER_CACHE_TTL_MS`：provider 识别缓存 TTL（毫秒），默认 `3600000`。
- `LINE_PROVIDER_RULES_JSON`：provider 规则扩展（JSON 数组）。与内置规则合并使用。
- `LINE_SSL_CACHE_TTL_MS`：线路证书聚合缓存 TTL（毫秒），默认 `300000`。
- `LINE_SSL_TLS_TIMEOUT_MS`：TLS 证书探测超时（毫秒），默认 `5000`。
- `LINE_SSL_RESOLVE_CONCURRENCY`：线路证书并发探测数，默认 `8`。

`LINE_PROVIDER_RULES_JSON` 规则格式（单条）：

- `name`：规则名（可选，便于排查）。
- `provider`：`aliyun_dcdn | aws_global | aliyun_esa | unknown`。
- `pattern`：正则表达式主体（不要写两侧 `/`）。
- `flags`：正则 flags（可选，如 `i`）。

示例：

```env
LINE_PROVIDER_RULES_JSON=[{"name":"custom-aws-cdn","provider":"aws_global","pattern":"\\.example-aws-cdn\\.com$","flags":"i"},{"name":"custom-aliyun-esa","provider":"aliyun_esa","pattern":"\\.edge\\.example\\.aliyun\\.com$","flags":"i"}]
```

## 5. 前端任务清单

### 5.1 路由与菜单

- 启用 `/lines` 页面为线路总览入口。
- 菜单新增“线路总览”（保留“新增线路”）。

### 5.2 页面改造

- 基于 `LineListPage` 升级为总览页。
- 新增查询条件：
  - 租户（支持“全部租户”）
  - `lineUrl`
  - Provider
  - 可用性
  - 证书剩余天数阈值
- 新增按钮：
  - 查询（刷新当前筛选结果）
  - 强制刷新（触发后端 `refresh=true`）
- 说明：
  - “刷新当前页”按钮属于可选增强，不是必需能力。若“查询”已可刷新当前条件结果，可不单独提供该按钮。

### 5.3 表格列建议

- `tenantId`
- `tenantName`（可选）
- `zh` / `en`
- `lineUrl`
- `status`
- `provider`
- `sslExpireAt`
- `sslDaysLeft`
- `availability`
- `lastCheckedAt`
- `error`（仅摘要，例如 `timeout`/`http_5xx`/`no_data`，不展示原始明细）

### 5.4 UI 交互规范

- `status/provider/availability` 使用 `Tag` 颜色区分。
- `sslDaysLeft <= 7` 高亮告警，`<= 0` 标红。
- 列表加载失败展示错误提示，不吞错。
- 每行可提供“查看探测详情”外链（跳转到探测项目），但不在本页内展开延迟明细。

## 6. 接口契约建议（草案）

### 6.1 请求示例

```http
GET /api/lines/inventory?page=1&size=20&tenantId=1001&provider=aliyun_dcdn&refresh=true
```

### 6.2 响应示例

```json
{
  "page": 1,
  "size": 20,
  "total": 123,
  "items": [
    {
      "tenantId": 1001,
      "zh": "线路-a",
      "en": "line-a",
      "lineUrl": "https://a.example.com",
      "status": true,
      "provider": "aliyun_dcdn",
      "sslExpireAt": "2026-06-30T12:00:00Z",
      "sslDaysLeft": 75,
      "availability": "up",
      "lastCheckedAt": "2026-04-16T03:00:00Z",
      "error": "none",
      "availabilityScore": 99.5,
      "successRegions": 199,
      "failedRegions": 1,
      "unknownRegions": 0,
      "totalRegions": 200
    }
  ],
  "fetchedAt": "2026-04-16T03:00:05Z"
}
```

接口字段边界说明：

- 不返回探测原始字段数组（例如 `region`、`latency_ms`、`http_status` 多记录明细）。
- 如需深度分析，前端跳转探测系统页面处理。
- 枚举约束：
  - `availability ∈ {up, down, unknown}`
  - `error ∈ {none, timeout, http_4xx, http_5xx, dns_error, tcp_error, ssl_error, probe_unreachable, stale_data, no_data, unknown_error}`
- 摘要统计字段：
  - `availabilityScore`：可用率百分比（`success/(success+failed)*100`）
  - `successRegions/failedRegions/unknownRegions/totalRegions`：region 聚合统计，仅用于摘要展示

## 7. 迭代计划

### Phase 1（建议 2~3 天）

- 启用 `/lines` 页面入口。
- 新增 `/lines/inventory` 接口骨架。
- 返回基础线路信息 + provider 初版 + 手动刷新。

### Phase 2（建议 2~4 天）

- 接入 SSL 到期时间与剩余天数计算。
- 接入可用性探测（`up/down/unknown`）。
- 增加缓存与并发控制。

### Phase 3（建议 1~2 天）

- 增加导出、异常筛选优化。
- 日志与指标补齐。
- 规则迭代，降低 `unknown provider` 占比。

## 8. 验收标准

1. 不选租户时可查询当前环境“全部租户线路”。
2. 列表包含基础字段 + Provider + 证书到期 + 可用性。
3. DCDN 线路能正确展示证书到期与剩余天数。
4. 每条线路有可用性状态与检查时间。
5. 当部分线路检查失败时，页面仍可展示其他结果。
6. 在 100 条线路场景下，接口性能满足可接受范围（分页可用，无明显卡顿）。

## 9. 风险与注意事项

- 线路来源数据格式可能不稳定（上游字段名差异），需要统一规范化。
- Provider 识别首版基于规则，存在误判风险，需保留 `unknown`。
- 可用性探测受网络与依赖环境影响，建议明确超时与重试策略。
- 建议避免在请求链路做过重探测，优先缓存与并发治理。
- 若接入外部探测接口，需要控制依赖耦合：本系统只消费“可用性摘要语义”，不绑定对方完整数据模型。

## 10. 实施前检查清单

- [ ] 确认 `/lines` 菜单权限与路由策略
- [ ] 确认后端配置项（并发、超时、缓存 TTL）
- [ ] 确认 Provider 规则样本（AWS/DCDN/ESA）
- [ ] 确认前端字段与排序展示规则
- [ ] 确认测试样本（多租户、异常线路、证书临期线路）

## 11. 后续优化与配置治理（待办）

本节为 MVP 之后的优化方向，当前版本可先不实现。

### 11.1 配置分层建议

- `.env` 仅保留“技术参数”：
  - 探测接口地址、超时、缓存 TTL、默认阈值等。
- 页面配置（落库）承载“业务策略”：
  - Provider 识别规则（域名特征 -> provider）。
  - 可用性判定阈值（例如 `up` 阈值、有效时间窗）。
  - 覆盖策略（全局默认/环境级/线路级）。

### 11.2 建议新增配置表（后续）

可按需增加以下配置表，用于替代频繁改 `.env` 的方式。

1. `line_provider_rules`（Provider 识别规则）

- 用途：维护“匹配规则 -> provider”映射，支持按优先级匹配。
- 建议字段：`environment_id`、`name`、`pattern`、`match_type(regex|contains|suffix)`、`provider`、`priority`、`enabled`、`updated_by`。

1. `line_inventory_policies`（可用性策略）

- 用途：维护可用性判定阈值和窗口配置。
- 建议字段：`environment_id`、`availability_window_ms`、`up_threshold`、`min_effective_regions`、`cache_ttl_ms`、`probe_timeout_ms`、`enabled`、`updated_by`。

1. `line_inventory_ssl_cache`（线路证书缓存）

- 用途：持久化线路证书到期聚合结果，支持跨实例共享缓存与审计排查。
- 建议字段：`environment_id`、`host`、`provider`、`ssl_expire_at`、`ssl_days_left`、`source`、`last_checked_at`、`expires_at`、`last_error`。

### 11.3 可选 SQL 草案（后续使用）

```sql
CREATE TABLE IF NOT EXISTS line_provider_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  environment_id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  pattern VARCHAR(512) NOT NULL,
  match_type ENUM('regex','contains','suffix') NOT NULL DEFAULT 'regex',
  provider ENUM('aliyun_dcdn','aws_global','aliyun_esa','unknown') NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_env_enabled_priority (environment_id, enabled, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS line_inventory_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  environment_id VARCHAR(64) NOT NULL,
  availability_window_ms INT NOT NULL DEFAULT 120000,
  up_threshold DECIMAL(5,4) NOT NULL DEFAULT 0.8000,
  min_effective_regions INT NOT NULL DEFAULT 1,
  cache_ttl_ms INT NOT NULL DEFAULT 15000,
  probe_timeout_ms INT NOT NULL DEFAULT 3000,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_env (environment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

补充：`line_inventory_ssl_cache` 的独立 SQL 文件已提供，路径：

- `eks-dashboard-backend/scripts/sql/2026-04-18_line_inventory_ssl_cache.sql`

### 11.4 `line_inventory_ssl_cache` 字段说明

- `id`：主键，自增 ID。
- `environment_id`：环境 ID，和页面环境上下文一致。
- `host`：标准化后的线路主机名（不含协议、路径、端口）。
- `provider`：provider 快照（`aliyun_dcdn` / `aws_global` / `aliyun_esa` / `unknown`）。
- `ssl_expire_at`：证书到期时间（UTC）。
- `ssl_days_left`：剩余天数（按当前时间计算，允许负值表示已过期）。
- `source`：证书信息来源（`dcdn_api` / `tls_probe` / `unknown`）。
- `last_checked_at`：最近一次成功或失败采集时间。
- `expires_at`：缓存过期时间；查询可优先命中 `expires_at > NOW()` 的记录。
- `last_error`：最近一次采集失败摘要，便于排查。
- `created_at` / `updated_at`：记录创建/更新时间。

建议治理策略：

- 定时清理 `expires_at` 过久且长期未更新的数据（例如 7~30 天）。
- 刷新策略使用 UPSERT（按 `environment_id + host` 唯一键更新）。

### 11.5 页面化配置建议（后续）

- 在线路总览页增加“规则设置”入口（仅管理员可见）。
- 支持：
  - Provider 规则 CRUD、排序、启停、正则校验。
  - 可用性阈值配置与实时预览（配置后立即生效）。
- 配置变更保留审计日志（谁在什么时间改了什么）。

## 12. 截至目前进度与后续计划（2026-04-18）

### 12.1 当前进度（已完成）

- 已启用 `/lines` 页面，并接入线路总览查询接口。
- 已上线 `GET /api/lines/inventory` 聚合接口（分页、`tenantId`、`lineUrl`、`provider`、`status`、`availability`、`refresh`）。
- 已实现可用性聚合（`up/down/unknown`）与可用率计算（`availabilityScore`）。
- 已实现区域样本聚合统计（`successRegions/failedRegions/unknownRegions/totalRegions`）。
- 已实现“查询”和“强制刷新”分离：
  - 查询优先使用短缓存快照。
  - 强制刷新绕过缓存直连探测源（失败时回退缓存）。
- 已实现 Provider 识别 MVP：
  - 内置规则（AWS/DCDN/ESA）+ CNAME 链匹配。
  - 支持 `LINE_PROVIDER_RULES_JSON` 扩展规则。
- 已实现证书信息聚合（MVP）：
  - DCDN 线路优先通过阿里云接口读取证书到期时间。
  - 其他线路（以及 DCDN 接口失败场景）回退 TLS 探测证书到期时间。
  - 仅对“已开启（status=true）”线路执行证书检查，未开启线路保持 `-`。
  - 返回 `sslExpireAt`、`sslDaysLeft`，并支持内存缓存 + `line_inventory_ssl_cache` 持久化缓存。
- 前端筛选已支持“是否启用”，默认值为“启用”。
- 已补齐文档与 `.env-example` 中的核心配置项（包括 `LINE_AVAILABILITY_UP_THRESHOLD`、`LINE_PROVIDER_RULES_JSON`）。
- 已完成全量过滤语义（`status/provider/availability/certExpireDaysLt`）与分页 `total` 严格一致：
  - 命中过滤条件时，后端先全量拉取线路，再过滤、再分页。
  - 返回 `total` 为过滤后的真实总数，前端分页器与结果一致。

### 12.2 当前差距（未完成/待优化）

- 前端尚未提供 `certExpireDaysLt` 查询输入与参数透传，无法在页面直接按证书剩余天数筛选。
- Provider 识别仍有 `unknown` 占比，规则命中率需继续提升（样本库与后缀规则需补充）。
- “查看探测详情”外链尚未在表格行内落地，定位问题仍需手工跳转探测系统。
- 缺少面向运维的指标与面板（命中率、错误码分布、刷新耗时、探测源可达性）。
- 缺少自动化测试覆盖（接口契约、聚合边界、规则匹配回归）。

### 12.3 后续任务（建议执行顺序）

1. 实现全量过滤语义（P1）

- 将 `status/provider/availability/certExpireDaysLt` 下推到全量查询链路，避免“仅当前页过滤”。
- 对应返回的 `total` 与分页器保持严格一致，不出现跨页偏差。

当前状态：已完成（2026-04-18）。

1. 完成证书信息聚合（P1）

- 在 `/api/lines/inventory` 中补齐 `sslExpireAt`、`sslDaysLeft` 的真实值。
- 打通 `certExpireDaysLt` 过滤并补充边界测试（临期、过期、无证书）。

当前状态：后端已完成（2026-04-18），前端筛选输入与测试待补齐。

1. 补齐前端筛选与跳转能力（P1）

- 在线路总览查询区增加“证书剩余天数阈值”输入，并透传 `certExpireDaysLt`。
- 在线路列表增加“查看探测详情”外链列（跳转探测系统对应页面）。

1. 提升 Provider 识别准确率（P1）

- 按线上样本补充 `LINE_PROVIDER_RULES_JSON`（后缀优先、规则命名标准化）。
- 增加“判定可观测字段”（日志或调试开关），用于定位 `unknown` 原因。

1. 补齐可观测性与稳定性（P2）

- 增加聚合接口关键指标：请求耗时、探测回退次数、错误码分布、provider 命中率。
- 明确告警阈值（探测源不可达、`unknown` 占比异常上升）。

1. 补齐测试与验收脚本（P2）

- 后端：`buildAvailabilitySummaryByHost`、provider 规则匹配、缓存/强刷行为单测。
- 前端：筛选参数透传、区域样本展示、空状态与错误提示。

1. 配置治理与页面化（P3）

- 评估将规则与阈值从 `.env` 迁移到配置表（见 11.2/11.3）。
- 规划“线路总览-规则设置”页面（管理员可见，带审计日志）。
