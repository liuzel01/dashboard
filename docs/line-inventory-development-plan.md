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
- 手动刷新与强制刷新（绕过缓存）。

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

### 4.5 性能与稳定性

- 并发限制：建议 10（可配置）。
- 单条探测超时：建议 3~5 秒（可配置）。
- 全链路超时：建议 15~30 秒。
- 短缓存：建议 1~5 分钟；`refresh=true` 直连刷新。
- 部分失败容忍：单条失败不影响整体返回。

### 4.6 可观测性

- 接口耗时、探测成功率、provider 命中率、错误分布。
- 关键日志字段：environmentId、tenantId、lineUrl、provider、availability、errorCode。

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
  - 刷新当前页
  - 强制刷新（触发后端 `refresh=true`）

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
      "error": "none"
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
