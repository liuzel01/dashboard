# AI 运维管理端（AIOps）落地方案与开发里程碑

本文档用于评审并落地 dashboard 新增 AI 菜单页，定位为“管理端 + 工具端”。

## 0. 当前进度（截至 2026-04-08）

已完成：
- M0 基础骨架已完成：`/ai-ops` 菜单页、后端模块、权限 key、审计表 SQL 脚本。
- M1 部分能力已完成：受控 SQL `preview/execute`、白名单/LIMIT/只读限制、SQL 审计回放。
- CloudWatch 与 Lambda 慢查询 webhook 已接入并做事件归一化入库。
- LLM 已切换为 OpenClaw gateway 模式（默认 `openclaw/default`）。
- 新增 LLM 探活接口：`GET /api/ai-ops/health/llm`（检查 gateway 连通性与模型列表）。

待完成（当前阶段）：
- M1 收尾：补齐 SQL 安全策略细节（更严格 AST、关键字规则回归测试）。
- M2 起步：RAG 文档导入与引用链路。
- M3 起步：慢查询分析报告生成（索引建议/执行计划解释）。

## 1. 结论（是否可行）

可行，建议按“只读优先、审计优先、分阶段上线”实施。

当前项目已具备可复用基础：

- 菜单与权限控制（`menu:*`）
- 环境切换（`X-Target-Environment`）
- 查询能力（`query`/`database`/`redis`）
- 日志能力（WebSocket 日志流）
- Lark Webhook 告警能力（`alerts` 模块）

这意味着首版不需要重构底座，只需新增一个 `ai-ops` 模块与前端页面，并把 SQL 安全网关、RAG、慢查询分析、故障定位编排接入现有模块。

## 2. 目标与边界

目标：

- 给运维一线提供统一 AI 工具页：问答、SQL 助手、慢查询分析、故障定位。
- 输出可追溯结论（带证据来源），并可选推送到 Lark 告警群。

首期边界（必须坚持）：

- 仅支持只读查询（禁止 DDL/DML）。
- 不做自动执行处置，默认“人工确认后执行”。
- 模型输出必须绑定证据来源与审计记录。

## 3. 能力分层（优化后）

### 3.1 知识问答（RAG）

- 数据源：SOP、故障手册、架构文档、常见告警说明。
- 流程：文档清洗 -> 分块 -> 向量检索 -> rerank -> 回答 + 引用片段。
- 要求：答案必须显示来源文档与段落 ID。

### 3.2 自然语言转 SQL（受控）

- 流程：NL 意图 -> SQL 草案 -> AST 校验 -> 安全重写（LIMIT）-> 执行。
- 强约束：
  - 只读账号（强制）
  - 白名单库/表
  - 单语句限制
  - 自动 `LIMIT`（默认 200，上限 1000）
  - 超时限制（例如 5s）
  - 危险关键词与语法拦截

### 3.3 慢查询分析

- 输入：慢日志（MySQL slow log / performance_schema 摘要）。
- 输出：
  - 问题 SQL 指纹
  - 执行计划解读（EXPLAIN）
  - 索引建议（含风险说明）
- 结果可推送至 Lark（建议复用现有 webhook 配置）。

### 3.4 故障定位助手

- 汇聚：告警、日志、指标、发布/配置变更时间线。
- 输出：
  - 最可能根因（带置信度）
  - 排查路径（步骤化）
  - 下一步建议（人工执行）

### 3.5 半自动处置（后期）

- 仅生成变更建议或脚本草稿。
- 必须二次确认与权限校验后才能执行。

## 4. 关键技术方案

### 4.1 Agent 编排

建议最小编排链路：

- Step 1: 意图识别（问答/查数/慢查/故障定位）
- Step 2: 选择工具（RAG/DB/日志/监控）
- Step 3: 汇总证据并生成结论
- Step 4: 审计入库 + 可选 Lark 推送

首版可采用“规则路由 + 单模型调用”，不必一开始做复杂多 Agent。

### 4.2 SQL 安全网关（核心）

建议落在后端新模块中，独立于模型层：

- `parse(sql)`：AST 解析
- `validate(ast)`：仅允许 `SELECT/SHOW/EXPLAIN`
- `enforce(sql)`：自动补 LIMIT、超时、行数上限
- `execute(sql)`：只读连接执行
- `audit(...)`：记录请求、用户、环境、原始问题、最终 SQL、耗时、结果行数

注意：不信任 LLM 生成 SQL，必须二次校验后才能执行。

### 4.3 RAG 质量控制

- 文档入库前做去噪和结构化（标题、系统、版本、更新时间）。
- 检索后必须 rerank。
- 回答低置信度时不“编造”，直接提示“证据不足”。

### 4.4 可观测性接入

优先顺序建议：

- P1：复用现有站点监控、日志能力
- P2：优先接入现网 CloudWatch/Lambda 告警链路（不重复建设）
- P3：Prometheus/Grafana 查询适配
- P4：Loki/ELK 与 APM 统一检索

### 4.5 现网 CloudWatch/Lambda 复用策略（新增）

结论：不建议重复实现 EC2 资源监控和慢查询监控，建议接入现有告警数据源。

建议接入方式：

- CloudWatch 告警：通过 EventBridge/SNS 将告警事件投递到 dashboard 后端 webhook（如 `POST /api/ai-ops/events/cloudwatch`）。
- 慢查询告警（Lambda）：让现有 Lambda 在发 Lark 的同时，额外投递一份结构化事件到 dashboard webhook（如 `POST /api/ai-ops/events/slow-query`）。
- 指标查询：AI 页面按需调用 AWS CloudWatch API（`GetMetricData`/`Metric Insights`）拉取 CPU/内存/磁盘趋势用于分析，不再自建采集。

实现原则：

- 不解析 Lark 群消息作为主数据源；Lark 仅作为通知终端。
- 统一做事件归一化（environmentId、resourceId、alarmName、severity、occurredAt、sourceUrl）。
- 做幂等去重（`alarmArn + stateChangeTime` 或慢查询事件指纹）。

### 4.6 权限与审计

建议新增权限 key：

- `menu:ai-ops`
- `aiops:qa`
- `aiops:sql:generate`
- `aiops:sql:execute`
- `aiops:incident:analyze`
- `aiops:slowlog:analyze`
- `aiops:notify:lark`

建议新增审计表：

- `aiops_sessions`（会话）
- `aiops_actions`（每次工具调用）
- `aiops_sql_audit`（SQL 专项审计）

## 5. 页面与接口建议

前端新增菜单页：

- 路由：`/ai-ops`
- 页面分栏：`问答`、`SQL 助手`、`慢查询分析`、`故障定位`、`审计记录`

后端新增模块：

- `POST /api/ai-ops/chat`（统一入口，按意图路由）
- `POST /api/ai-ops/sql/preview`（生成 + 校验，不执行）
- `POST /api/ai-ops/sql/execute`（执行受控 SQL）
- `GET /api/ai-ops/audit/sql`
- `GET /api/ai-ops/health/llm`（OpenClaw gateway 探活）
- `POST /api/ai-ops/events/cloudwatch`
- `POST /api/ai-ops/events/slow-query`
- `POST /api/ai-ops/slow-query/analyze`（规划中）
- `POST /api/ai-ops/incident/analyze`（规划中）
- `POST /api/ai-ops/notify/lark`（规划中）

## 6. 里程碑（可执行版）

### M0（1 周）：基线与安全框架

状态：已完成（2026-04-08）

交付：

- 新增菜单与空页面（受权限控制）。
- 新增 `ai-ops` 后端模块骨架与审计中间件。
- 定义权限 key、角色映射、审计表 SQL。

验收标准：

- 无权限用户不可见菜单且不可调接口。
- 每次调用都可在审计表追踪到用户/环境/动作。

### M1（1~2 周）：受控 NL2SQL MVP

状态：进行中（已完成核心链路）

交付：

- NL -> SQL（只读）能力。
- SQL AST 校验、白名单、LIMIT/超时/行数限制。
- `preview + execute` 双接口。

验收标准：

- DDL/DML/多语句全部被拒绝。
- 结果默认分页且单次查询可控。
- 审计可回放“自然语言 -> SQL -> 结果摘要”。

已完成项（当前）：
- SQL preview / execute API。
- OpenClaw gateway 模型调用链路。
- SQL 审计入库与查询。

剩余项（M1 收尾）：
- AST 级校验增强与回归测试。
- 更细粒度权限策略（生成与执行分离验证）。

### M1 增强（最小可用优先，新增）

结论：与后续 M2（RAG）/M3（慢查询分析）不冲突，可先落地以下两项：

- 方案1（Schema 上下文注入）：
  - 目标：让模型在生成 SQL 前拿到 `db.table + columns` 的已知上下文，优先解决“SQL 不靠谱/不带库名”。
  - 做法：按环境白名单提取可访问 schema，裁剪后注入提示词，仅给本次请求相关表结构。
- 方案2（生成后校验 + 重写闭环）：
  - 目标：模型首轮生成不合规时自动修正，提高一次可用率。
  - 做法：生成 SQL -> 安全校验（只读/白名单/库名限定/LIMIT）-> 失败时带校验原因重试重写，达到最大重试次数后报错。

实施边界（M1 增强阶段）：

- 不引入向量库，不引入文档检索链路（避免与 M2 范围重叠）。
- 仅围绕 NL2SQL 质量和稳定性改进，保持接口契约不变。

后续增强顺序（保持不变）：

- 方案3（few-shot 示例库）：低成本高收益，建议在 M1.5 补齐。
- 方案4（数据字典 RAG）：建设成本最高，放在 M2/M2+ 逐步推进。

### M2（1~2 周）：RAG 问答 MVP

交付：

- 文档索引链路（导入、分块、向量检索、rerank）。
- 问答 UI 与来源引用展示。

验收标准：

- 每条回答至少带 1 个来源片段。
- 无命中时返回“未找到证据”，不胡乱生成。

### M3（1~2 周）：慢查询分析与 Lark 联动

交付：

- 慢查询样本解析与归类（按指纹聚合）。
- 生成执行计划解读与索引建议。
- 分析结果一键推送到 Lark（复用现有 webhook 配置）。

验收标准：

- 可稳定分析样本并输出结构化结论。
- 推送消息包含环境、SQL 指纹、建议与风险说明。

### M4（2 周）：故障定位助手（多源时间线）

交付：

- 接入告警/日志/指标/发布记录时间线拼接。
- 根因候选与排查路径生成。

验收标准：

- 输出结果包含证据列表与置信度。
- 可追溯到原始事件与查询链接。

## 7. 主要风险与控制

风险：

- LLM 幻觉导致误判。
- SQL 越权或高开销查询。
- 多数据源时间线错位，导致错误归因。

控制：

- 强制证据引用 + 低置信度拒答。
- SQL 网关独立防线（与模型解耦）。
- 统一时间戳与环境上下文（environmentId）对齐。

## 8. 对你初版方案的评审结论

你的初版方案方向正确，技术路径也合理；建议增强以下三点后再开工：

- 把“SQL 安全网关”提升为 P0，不作为附属能力。
- 把“权限与审计”提前到 M0，避免先上线后补审计。
- 把“半自动处置”放到最后阶段，并默认禁用自动执行。

按本文档节奏推进，可以在较低风险下快速交付一个可用的 AI 运维管理页。
